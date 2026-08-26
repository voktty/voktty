use std::env;
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Command, ExitCode, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use voktty_aliases::{
    AliasContext, AliasFile, AliasSource, AliasTarget, BuiltinAction, ResolvedAlias,
};
use voktty_control_protocol::{
    CallerContext, ControlDescriptor, ControlRequest, ControlResponse, OpenParams,
    MAX_MESSAGE_BYTES, METHOD_CAPABILITIES, METHOD_IDENTIFY, METHOD_OPEN, METHOD_PING,
    PROTOCOL_VERSION, SERVER_RESPONSE_ID,
};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const IO_TIMEOUT: Duration = Duration::from_secs(7);
const EXIT_USAGE: u8 = 2;
const EXIT_UNAVAILABLE: u8 = 3;
const EXIT_PROTOCOL: u8 = 4;
const EXIT_REQUEST: u8 = 5;
static REQUEST_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, PartialEq)]
enum Action {
    Help,
    Version,
    Request { method: &'static str, params: Value },
    Alias(AliasCommand),
}

#[derive(Debug, PartialEq)]
enum AliasCommand {
    List,
    Path,
    Edit,
    Run { name: String, args: Vec<OsString> },
    Test { name: String, args: Vec<OsString> },
    Import { path: PathBuf },
    Export { path: PathBuf, force: bool },
}

#[derive(Debug, PartialEq)]
struct Config {
    json: bool,
    action: Action,
}

#[derive(Debug)]
struct CliError {
    code: String,
    message: String,
    exit: u8,
}

impl CliError {
    fn new(code: impl Into<String>, message: impl Into<String>, exit: u8) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            exit,
        }
    }
}

fn main() -> ExitCode {
    match run(env::args_os().skip(1).collect()) {
        Ok(exit) => exit,
        Err(error) => {
            let mut display_args: Vec<OsString> = env::args_os().skip(1).collect();
            let json = extract_json_flag(&mut display_args);
            if json {
                eprintln!(
                    "{}",
                    json!({
                        "ok": false,
                        "error": { "code": error.code, "message": error.message }
                    })
                );
            } else {
                eprintln!("voktty: {}", error.message);
            }
            ExitCode::from(error.exit)
        }
    }
}

fn run(args: Vec<OsString>) -> Result<ExitCode, CliError> {
    let config = parse_args(args)?;
    match config.action {
        Action::Help => {
            print_help();
            Ok(ExitCode::SUCCESS)
        }
        Action::Version => {
            println!("voktty {}", env!("CARGO_PKG_VERSION"));
            Ok(ExitCode::SUCCESS)
        }
        Action::Request { method, params } => {
            let endpoint = load_endpoint()?;
            let caller = env::var("VOKTTY_PANE_ID")
                .ok()
                .and_then(|value| value.parse::<u32>().ok());
            let request = ControlRequest {
                protocol: PROTOCOL_VERSION,
                id: request_id(),
                token: endpoint.token,
                method: method.to_string(),
                params,
                caller: CallerContext { pane_id: caller },
            };
            let response = send_request(&endpoint.address, &request)?;
            if !response.ok {
                let error = response.error.unwrap_or_else(|| {
                    voktty_control_protocol::ControlError::new(
                        "request_failed",
                        "Voktty rejected the request",
                    )
                });
                return Err(CliError::new(error.code, error.message, EXIT_REQUEST));
            }
            let result = response.result.unwrap_or(Value::Null);
            print_result(method, result, config.json);
            Ok(ExitCode::SUCCESS)
        }
        Action::Alias(command) => run_alias(command, config.json),
    }
}

fn parse_args(mut args: Vec<OsString>) -> Result<Config, CliError> {
    let json = extract_json_flag(&mut args);
    if args.is_empty() {
        return Ok(Config {
            json,
            action: Action::Help,
        });
    }

    let command = args.remove(0);
    let command_text = command.to_str();
    let action = match command_text {
        Some("help" | "--help" | "-h") => no_extra_args(args, Action::Help)?,
        Some("--version" | "-V" | "version") => no_extra_args(args, Action::Version)?,
        Some("ping") => request_without_params(args, METHOD_PING)?,
        Some("capabilities") => request_without_params(args, METHOD_CAPABILITIES)?,
        Some("identify") => request_without_params(args, METHOD_IDENTIFY)?,
        Some("open") => parse_open(args)?,
        Some("alias") => Action::Alias(parse_alias(args)?),
        Some("ipme") => Action::Alias(AliasCommand::Run {
            name: "ipme".into(),
            args,
        }),
        Some("--") => {
            args.insert(0, command);
            parse_open(args)?
        }
        Some(value) if value.starts_with('-') => {
            return Err(usage_error(format!("unknown option '{value}'")));
        }
        _ => {
            args.insert(0, command);
            parse_open(args)?
        }
    };
    Ok(Config { json, action })
}

fn parse_alias(mut args: Vec<OsString>) -> Result<AliasCommand, CliError> {
    if args.is_empty() {
        return Ok(AliasCommand::List);
    }
    let command = args.remove(0);
    match command.to_str() {
        Some("list") => no_alias_args(args, AliasCommand::List),
        Some("path") => no_alias_args(args, AliasCommand::Path),
        Some("edit") => no_alias_args(args, AliasCommand::Edit),
        Some("run") => parse_alias_invocation(args, false),
        Some("test") => parse_alias_invocation(args, true),
        Some("import") => parse_alias_path(args, false),
        Some("export") => parse_alias_path(args, true),
        Some(value) => Err(usage_error(format!("unknown alias command '{value}'"))),
        None => Err(usage_error("alias command must be valid UTF-8")),
    }
}

fn no_alias_args(args: Vec<OsString>, command: AliasCommand) -> Result<AliasCommand, CliError> {
    if args.is_empty() {
        Ok(command)
    } else {
        Err(usage_error("unexpected alias arguments"))
    }
}

fn parse_alias_invocation(mut args: Vec<OsString>, test: bool) -> Result<AliasCommand, CliError> {
    if args.first().is_some_and(|argument| argument == "--") {
        args.remove(0);
    }
    let name = args
        .first()
        .and_then(|value| value.to_str())
        .ok_or_else(|| usage_error("alias run requires a UTF-8 alias name"))?
        .to_string();
    args.remove(0);
    if args.first().is_some_and(|argument| argument == "--") {
        args.remove(0);
    }
    if test {
        Ok(AliasCommand::Test { name, args })
    } else {
        Ok(AliasCommand::Run { name, args })
    }
}

fn parse_alias_path(mut args: Vec<OsString>, export: bool) -> Result<AliasCommand, CliError> {
    let force = if export {
        let before = args.len();
        args.retain(|argument| argument != "--force");
        before != args.len()
    } else {
        false
    };
    if args.len() != 1 {
        return Err(usage_error(if export {
            "alias export requires one destination path"
        } else {
            "alias import requires one source path"
        }));
    }
    let path = PathBuf::from(args.remove(0));
    if export {
        Ok(AliasCommand::Export { path, force })
    } else {
        Ok(AliasCommand::Import { path })
    }
}

fn extract_json_flag(args: &mut Vec<OsString>) -> bool {
    let mut json = false;
    let mut after_separator = false;
    args.retain(|arg| {
        if after_separator {
            return true;
        }
        if arg == "--" {
            after_separator = true;
            return true;
        }
        if arg == "--json" {
            json = true;
            return false;
        }
        true
    });
    json
}

fn no_extra_args(args: Vec<OsString>, action: Action) -> Result<Action, CliError> {
    if args.is_empty() {
        Ok(action)
    } else {
        Err(usage_error("unexpected arguments"))
    }
}

fn request_without_params(args: Vec<OsString>, method: &'static str) -> Result<Action, CliError> {
    no_extra_args(
        args,
        Action::Request {
            method,
            params: json!({}),
        },
    )
}

fn parse_open(args: Vec<OsString>) -> Result<Action, CliError> {
    let mut path: Option<OsString> = None;
    let mut line = None;
    let mut focus = true;
    let mut options = true;
    let mut index = 0;
    while index < args.len() {
        let arg = &args[index];
        match arg.to_str() {
            Some("--") if options => options = false,
            Some("--line" | "-l") if options => {
                index += 1;
                let value = args
                    .get(index)
                    .and_then(|value| value.to_str())
                    .ok_or_else(|| usage_error("--line requires a positive integer"))?;
                let parsed = value
                    .parse::<u32>()
                    .ok()
                    .filter(|line| *line > 0)
                    .ok_or_else(|| usage_error("--line requires a positive integer"))?;
                line = Some(parsed);
            }
            Some("--no-focus") if options => focus = false,
            Some(value) if options && value.starts_with('-') => {
                return Err(usage_error(format!("unknown open option '{value}'")));
            }
            _ if path.is_none() => path = Some(arg.clone()),
            _ => return Err(usage_error("open accepts exactly one file path")),
        }
        index += 1;
    }

    let path = path.ok_or_else(|| usage_error("open requires a file path"))?;
    let canonical = std::fs::canonicalize(PathBuf::from(path)).map_err(|error| {
        CliError::new(
            "path_not_found",
            format!("cannot resolve file path: {error}"),
            EXIT_USAGE,
        )
    })?;
    if !canonical.is_file() {
        return Err(CliError::new(
            "not_a_file",
            format!("path is not a regular file: {}", canonical.display()),
            EXIT_USAGE,
        ));
    }
    let path = canonical.into_os_string().into_string().map_err(|_| {
        CliError::new(
            "non_utf8_path",
            "Voktty cannot open a path that is not valid UTF-8",
            EXIT_USAGE,
        )
    })?;
    let params = serde_json::to_value(OpenParams {
        path,
        line,
        column: None,
        focus,
    })
    .map_err(|error| {
        CliError::new(
            "serialization_error",
            format!("could not encode open request: {error}"),
            EXIT_PROTOCOL,
        )
    })?;
    Ok(Action::Request {
        method: METHOD_OPEN,
        params,
    })
}

fn usage_error(message: impl Into<String>) -> CliError {
    CliError::new("usage", message, EXIT_USAGE)
}

fn load_endpoint() -> Result<ControlDescriptor, CliError> {
    let env_address = env::var("VOKTTY_CONTROL_ADDR").ok();
    let env_token = env::var("VOKTTY_CONTROL_TOKEN").ok();
    let (descriptor, require_live_process) = match (env_address, env_token) {
        (Some(address), Some(token)) => (
            ControlDescriptor {
                protocol: PROTOCOL_VERSION,
                address,
                token,
                pid: 0,
                app_version: String::new(),
            },
            false,
        ),
        (None, None) => {
            let path = dirs::cache_dir()
                .map(|dir| dir.join("voktty").join("control.json"))
                .ok_or_else(|| {
                    CliError::new(
                        "app_unavailable",
                        "could not locate the user cache directory",
                        EXIT_UNAVAILABLE,
                    )
                })?;
            let bytes = std::fs::read(&path).map_err(|_| {
                CliError::new(
                    "app_unavailable",
                    "Voktty is not running; start the app and try again",
                    EXIT_UNAVAILABLE,
                )
            })?;
            let descriptor = serde_json::from_slice(&bytes).map_err(|error| {
                CliError::new(
                    "invalid_descriptor",
                    format!("invalid Voktty control descriptor: {error}"),
                    EXIT_PROTOCOL,
                )
            })?;
            (descriptor, true)
        }
        _ => {
            return Err(CliError::new(
                "invalid_environment",
                "VOKTTY_CONTROL_ADDR and VOKTTY_CONTROL_TOKEN must be set together",
                EXIT_PROTOCOL,
            ));
        }
    };
    validate_endpoint(descriptor, require_live_process)
}

fn validate_endpoint(
    descriptor: ControlDescriptor,
    require_live_process: bool,
) -> Result<ControlDescriptor, CliError> {
    if descriptor.protocol != PROTOCOL_VERSION {
        return Err(CliError::new(
            "unsupported_protocol",
            format!(
                "Voktty uses control protocol {}, but this CLI supports {PROTOCOL_VERSION}",
                descriptor.protocol
            ),
            EXIT_PROTOCOL,
        ));
    }
    if descriptor.token.len() != 64
        || !descriptor
            .token
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(CliError::new(
            "invalid_endpoint",
            "Voktty control token is invalid",
            EXIT_PROTOCOL,
        ));
    }
    parse_loopback_address(&descriptor.address)?;
    if require_live_process && !process_is_alive(descriptor.pid) {
        return Err(CliError::new(
            "invalid_endpoint",
            "Voktty control process is not running",
            EXIT_PROTOCOL,
        ));
    }
    Ok(descriptor)
}

#[cfg(unix)]
fn process_is_alive(pid: u32) -> bool {
    let Ok(pid) = libc::pid_t::try_from(pid) else {
        return false;
    };
    if pid <= 0 {
        return false;
    }
    let result = unsafe { libc::kill(pid, 0) };
    result == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(windows)]
fn process_is_alive(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ACCESS_DENIED};
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

    if pid == 0 {
        return false;
    }
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if !handle.is_null() {
            CloseHandle(handle);
            true
        } else {
            GetLastError() == ERROR_ACCESS_DENIED
        }
    }
}

fn send_request(address: &str, request: &ControlRequest) -> Result<ControlResponse, CliError> {
    let address = parse_loopback_address(address)?;
    let mut stream = TcpStream::connect_timeout(&address, CONNECT_TIMEOUT).map_err(|error| {
        CliError::new(
            "app_unavailable",
            format!("could not connect to Voktty: {error}"),
            EXIT_UNAVAILABLE,
        )
    })?;
    stream.set_read_timeout(Some(IO_TIMEOUT)).ok();
    stream.set_write_timeout(Some(IO_TIMEOUT)).ok();
    write_request(&mut stream, request)?;

    let mut reader = BufReader::new(stream);
    read_response(&mut reader, request)
}

fn parse_loopback_address(address: &str) -> Result<SocketAddr, CliError> {
    let address: SocketAddr = address.parse().map_err(|error| {
        CliError::new(
            "invalid_endpoint",
            format!("invalid Voktty control address: {error}"),
            EXIT_PROTOCOL,
        )
    })?;
    if !address.ip().is_loopback() {
        return Err(CliError::new(
            "invalid_endpoint",
            "Voktty control address must be loopback-only",
            EXIT_PROTOCOL,
        ));
    }
    Ok(address)
}

fn write_request(writer: &mut impl Write, request: &ControlRequest) -> Result<(), CliError> {
    serde_json::to_writer(&mut *writer, request).map_err(|error| {
        CliError::new(
            "serialization_error",
            format!("could not encode request: {error}"),
            EXIT_PROTOCOL,
        )
    })?;
    writer.write_all(b"\n").map_err(io_error)?;
    writer.flush().map_err(io_error)
}

fn read_response(
    reader: &mut impl BufRead,
    request: &ControlRequest,
) -> Result<ControlResponse, CliError> {
    let mut bytes = Vec::new();
    reader
        .by_ref()
        .take((MAX_MESSAGE_BYTES + 1) as u64)
        .read_until(b'\n', &mut bytes)
        .map_err(io_error)?;
    if bytes.len() > MAX_MESSAGE_BYTES {
        return Err(CliError::new(
            "message_too_large",
            "Voktty response exceeded the protocol limit",
            EXIT_PROTOCOL,
        ));
    }
    if bytes.last() != Some(&b'\n') {
        return Err(CliError::new(
            "invalid_response",
            "Voktty returned an incomplete response",
            EXIT_PROTOCOL,
        ));
    }
    let response: ControlResponse = serde_json::from_slice(&bytes).map_err(|error| {
        CliError::new(
            "invalid_response",
            format!("Voktty returned invalid JSON: {error}"),
            EXIT_PROTOCOL,
        )
    })?;
    let matched_id =
        response.id == request.id || (!response.ok && response.id == SERVER_RESPONSE_ID);
    if response.protocol != PROTOCOL_VERSION || !matched_id {
        return Err(CliError::new(
            "invalid_response",
            "Voktty returned a mismatched protocol version or request id",
            EXIT_PROTOCOL,
        ));
    }
    Ok(response)
}

fn io_error(error: std::io::Error) -> CliError {
    CliError::new(
        "io_error",
        format!("control connection failed: {error}"),
        EXIT_UNAVAILABLE,
    )
}

fn request_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let sequence = REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{}-{nanos}-{sequence}", std::process::id())
}

fn run_alias(command: AliasCommand, as_json: bool) -> Result<ExitCode, CliError> {
    let path = voktty_aliases::config_path().map_err(alias_config_error)?;
    match command {
        AliasCommand::Path => {
            if as_json {
                println!("{}", json!({ "ok": true, "path": path }));
            } else {
                println!("{}", path.display());
            }
            Ok(ExitCode::SUCCESS)
        }
        AliasCommand::Edit => {
            voktty_aliases::ensure_file(&path).map_err(alias_config_error)?;
            open_alias_file(&path, as_json)?;
            Ok(ExitCode::SUCCESS)
        }
        AliasCommand::List => {
            let user = voktty_aliases::load_user(&path).map_err(alias_config_error)?;
            let context = alias_context();
            let aliases = voktty_aliases::effective(&user);
            if as_json {
                let values = aliases
                    .values()
                    .map(|alias| {
                        json!({
                            "name": alias.name,
                            "source": alias.source,
                            "enabled": alias.definition.is_enabled(&context),
                            "description": alias.definition.description,
                            "target": alias.definition.target,
                        })
                    })
                    .collect::<Vec<_>>();
                println!("{}", json!({ "ok": true, "path": path, "aliases": values }));
            } else {
                for alias in aliases.values() {
                    let status = if alias.definition.is_enabled(&context) {
                        "enabled"
                    } else {
                        "disabled"
                    };
                    let source = match alias.source {
                        AliasSource::Preinstalled => "preinstalled",
                        AliasSource::User => "user",
                    };
                    println!(
                        "{}\t{status}\t{source}\t{}",
                        alias.name, alias.definition.description
                    );
                }
            }
            Ok(ExitCode::SUCCESS)
        }
        AliasCommand::Test { name, args } => {
            let user = voktty_aliases::load_user(&path).map_err(alias_config_error)?;
            let alias = resolve_alias(&user, &name)?;
            print_alias_plan(&alias, &args, as_json);
            Ok(ExitCode::SUCCESS)
        }
        AliasCommand::Run { name, args } => {
            let user = voktty_aliases::load_user(&path).map_err(alias_config_error)?;
            let alias = resolve_alias(&user, &name)?;
            execute_alias(alias, args, as_json)
        }
        AliasCommand::Import { path: source } => {
            let bytes = std::fs::read(&source).map_err(|error| {
                CliError::new(
                    "alias_import_failed",
                    format!("could not read {}: {error}", source.display()),
                    EXIT_USAGE,
                )
            })?;
            let imported = voktty_aliases::parse(&bytes).map_err(alias_config_error)?;
            let current = voktty_aliases::load_user(&path).map_err(alias_config_error)?;
            let merged = voktty_aliases::merge(&current, &imported).map_err(alias_config_error)?;
            voktty_aliases::write_atomic(&path, &merged).map_err(alias_config_error)?;
            print_alias_mutation("imported", &path, merged.aliases.len(), as_json);
            Ok(ExitCode::SUCCESS)
        }
        AliasCommand::Export {
            path: destination,
            force,
        } => {
            if destination.exists() && !force {
                return Err(CliError::new(
                    "alias_export_exists",
                    format!(
                        "{} already exists; pass --force to replace it",
                        destination.display()
                    ),
                    EXIT_USAGE,
                ));
            }
            let user = voktty_aliases::load_user(&path).map_err(alias_config_error)?;
            voktty_aliases::write_atomic(&destination, &user).map_err(alias_config_error)?;
            print_alias_mutation("exported", &destination, user.aliases.len(), as_json);
            Ok(ExitCode::SUCCESS)
        }
    }
}

fn alias_context() -> AliasContext {
    let workspace = env::var("VOKTTY_ALIAS_WORKSPACE").ok().or_else(|| {
        env::current_dir()
            .ok()
            .and_then(|path| path.into_os_string().into_string().ok())
    });
    let profile = env::var("VOKTTY_ALIAS_PROFILE").ok();
    AliasContext { workspace, profile }
}

fn resolve_alias(user: &AliasFile, name: &str) -> Result<ResolvedAlias, CliError> {
    voktty_aliases::resolve(user, name, &alias_context())
        .map_err(|message| CliError::new("alias_unavailable", message, EXIT_USAGE))
}

fn execute_alias(
    alias: ResolvedAlias,
    forwarded: Vec<OsString>,
    as_json: bool,
) -> Result<ExitCode, CliError> {
    match alias.definition.target {
        AliasTarget::Command { executable, args } => {
            let status = Command::new(&executable)
                .args(args)
                .args(forwarded)
                .stdin(Stdio::inherit())
                .stdout(Stdio::inherit())
                .stderr(Stdio::inherit())
                .status()
                .map_err(|error| {
                    CliError::new(
                        "alias_spawn_failed",
                        format!("could not start alias '{}': {error}", alias.name),
                        EXIT_UNAVAILABLE,
                    )
                })?;
            Ok(exit_code(status.code()))
        }
        AliasTarget::Builtin {
            action: BuiltinAction::Ipme,
        } => run_ipme(&forwarded, as_json),
    }
}

fn print_alias_plan(alias: &ResolvedAlias, forwarded: &[OsString], as_json: bool) {
    let source = match alias.source {
        AliasSource::Preinstalled => "preinstalled",
        AliasSource::User => "user",
    };
    match &alias.definition.target {
        AliasTarget::Command { executable, args } => {
            let forwarded = forwarded
                .iter()
                .map(|value| value.to_string_lossy().into_owned())
                .collect::<Vec<_>>();
            if as_json {
                println!(
                    "{}",
                    json!({
                        "ok": true,
                        "name": alias.name,
                        "source": source,
                        "kind": "command",
                        "executable": executable,
                        "fixedArgs": args,
                        "forwardedArgs": forwarded,
                    })
                );
            } else {
                println!(
                    "name={}\nsource={source}\nkind=command\nexecutable={executable}",
                    alias.name
                );
                for (index, argument) in args.iter().enumerate() {
                    println!("fixedArg[{index}]={argument}");
                }
                for (index, argument) in forwarded.iter().enumerate() {
                    println!("forwardedArg[{index}]={argument}");
                }
            }
        }
        AliasTarget::Builtin { action } => {
            let action = match action {
                BuiltinAction::Ipme => "ipme",
            };
            if as_json {
                println!(
                    "{}",
                    json!({
                        "ok": true,
                        "name": alias.name,
                        "source": source,
                        "kind": "builtin",
                        "action": action,
                    })
                );
            } else {
                println!(
                    "name={}\nsource={source}\nkind=builtin\naction={action}",
                    alias.name
                );
            }
        }
    }
}

fn run_ipme(args: &[OsString], as_json: bool) -> Result<ExitCode, CliError> {
    let mut public = false;
    let mut as_json = as_json;
    for argument in args {
        match argument.to_str() {
            Some("--public") => public = true,
            Some("--local") => {}
            Some("--json") => as_json = true,
            Some(value) => return Err(usage_error(format!("unknown ipme option '{value}'"))),
            None => return Err(usage_error("ipme options must be valid UTF-8")),
        }
    }
    let local = local_addresses();
    if local.is_empty() && !public {
        return Err(CliError::new(
            "local_ip_unavailable",
            "no routed local IP address is currently available",
            EXIT_UNAVAILABLE,
        ));
    }
    let public_address = if public { Some(public_ip()?) } else { None };
    if as_json {
        println!(
            "{}",
            json!({ "ok": true, "local": local, "public": public_address })
        );
    } else {
        if local.is_empty() {
            println!("Local IP: unavailable");
        } else {
            for address in local {
                println!("Local IP: {address}");
            }
        }
        if let Some(address) = public_address {
            println!("Public IP: {address}");
        } else {
            println!("Public IP: not requested (use --public)");
        }
    }
    Ok(ExitCode::SUCCESS)
}

fn local_addresses() -> Vec<String> {
    let candidates = [("0.0.0.0:0", "192.0.2.1:9"), ("[::]:0", "[2001:db8::1]:9")];
    let mut addresses = candidates
        .iter()
        .filter_map(|(bind, destination)| {
            let socket = std::net::UdpSocket::bind(bind).ok()?;
            socket.connect(destination).ok()?;
            let address = socket.local_addr().ok()?.ip();
            (!address.is_unspecified() && !address.is_loopback()).then(|| address.to_string())
        })
        .collect::<Vec<_>>();
    addresses.sort();
    addresses.dedup();
    addresses
}

fn public_ip() -> Result<String, CliError> {
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(6))
        .user_agent(concat!("Voktty/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(public_ip_error)?;
    let mut response = client
        .get("https://api.ipify.org")
        .send()
        .map_err(public_ip_error)?
        .error_for_status()
        .map_err(public_ip_error)?;
    if response.content_length().is_some_and(|length| length > 128) {
        return Err(CliError::new(
            "public_ip_failed",
            "public IP service returned an oversized response",
            EXIT_UNAVAILABLE,
        ));
    }
    let mut bytes = Vec::new();
    response
        .by_ref()
        .take(129)
        .read_to_end(&mut bytes)
        .map_err(|error| public_ip_error(error.to_string()))?;
    if bytes.len() > 128 {
        return Err(CliError::new(
            "public_ip_failed",
            "public IP service returned an oversized response",
            EXIT_UNAVAILABLE,
        ));
    }
    let value = String::from_utf8(bytes)
        .map_err(|_| public_ip_error("public IP service returned non-UTF-8 data"))?;
    let address = value
        .trim()
        .parse::<std::net::IpAddr>()
        .map_err(|_| public_ip_error("public IP service returned an invalid address"))?;
    Ok(address.to_string())
}

fn public_ip_error(error: impl std::fmt::Display) -> CliError {
    CliError::new(
        "public_ip_failed",
        format!("could not query the public IP: {error}; check the connection and retry"),
        EXIT_UNAVAILABLE,
    )
}

fn open_alias_file(path: &std::path::Path, as_json: bool) -> Result<(), CliError> {
    let canonical = std::fs::canonicalize(path).map_err(|error| {
        CliError::new(
            "alias_config_failed",
            format!("could not resolve {}: {error}", path.display()),
            EXIT_UNAVAILABLE,
        )
    })?;
    let path = canonical.into_os_string().into_string().map_err(|_| {
        CliError::new(
            "non_utf8_path",
            "alias configuration path is not valid UTF-8",
            EXIT_USAGE,
        )
    })?;
    let endpoint = load_endpoint()?;
    let caller = env::var("VOKTTY_PANE_ID")
        .ok()
        .and_then(|value| value.parse::<u32>().ok());
    let request = ControlRequest {
        protocol: PROTOCOL_VERSION,
        id: request_id(),
        token: endpoint.token,
        method: METHOD_OPEN.to_string(),
        params: serde_json::to_value(OpenParams {
            path,
            line: None,
            column: None,
            focus: true,
        })
        .map_err(|error| CliError::new("serialization_error", error.to_string(), EXIT_PROTOCOL))?,
        caller: CallerContext { pane_id: caller },
    };
    let response = send_request(&endpoint.address, &request)?;
    if !response.ok {
        let error = response.error.unwrap_or_else(|| {
            voktty_control_protocol::ControlError::new(
                "request_failed",
                "Voktty rejected the request",
            )
        });
        return Err(CliError::new(error.code, error.message, EXIT_REQUEST));
    }
    print_result(METHOD_OPEN, response.result.unwrap_or(Value::Null), as_json);
    Ok(())
}

fn print_alias_mutation(action: &str, path: &std::path::Path, count: usize, as_json: bool) {
    if as_json {
        println!(
            "{}",
            json!({ "ok": true, "action": action, "path": path, "count": count })
        );
    } else {
        println!("{action} {count} user aliases at {}", path.display());
    }
}

fn alias_config_error(message: String) -> CliError {
    CliError::new("alias_config_failed", message, EXIT_PROTOCOL)
}

fn exit_code(code: Option<i32>) -> ExitCode {
    match code {
        Some(0) => ExitCode::SUCCESS,
        Some(code) => ExitCode::from(u8::try_from(code).unwrap_or(1)),
        None => ExitCode::from(1),
    }
}

fn print_result(method: &str, result: Value, as_json: bool) {
    if as_json {
        println!("{}", json!({ "ok": true, "result": result }));
        return;
    }
    match method {
        METHOD_PING => {
            let version = result
                .get("app_version")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            println!("Voktty {version} is running");
        }
        METHOD_CAPABILITIES => {
            if let Some(methods) = result.get("methods").and_then(Value::as_array) {
                for method in methods.iter().filter_map(Value::as_str) {
                    println!("{method}");
                }
            }
        }
        METHOD_IDENTIFY => {
            let space = result
                .get("space_id")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            let tab = result
                .get("tab_id")
                .and_then(Value::as_u64)
                .map_or_else(|| "none".to_string(), |id| id.to_string());
            let pane = result
                .get("pane_id")
                .and_then(Value::as_u64)
                .map_or_else(|| "none".to_string(), |id| id.to_string());
            println!("space={space} tab={tab} pane={pane}");
        }
        METHOD_OPEN => {
            let path = result.get("path").and_then(Value::as_str).unwrap_or("");
            let line = result.get("line").and_then(Value::as_u64);
            if let Some(line) = line {
                println!("Opened {path}:{line} in Voktty");
            } else {
                println!("Opened {path} in Voktty");
            }
        }
        _ => println!("{result}"),
    }
}

fn print_help() {
    println!(
        "Voktty command line interface\n\n\
Usage:\n  voktty <file> [--line <n>] [--no-focus] [--json]\n  voktty open <file> [--line <n>] [--no-focus] [--json]\n  voktty ping|capabilities|identify [--json]\n  voktty alias list|path|edit [--json]\n  voktty alias run|test <name> [--] [args...] [--json]\n  voktty alias import <file> [--json]\n  voktty alias export <file> [--force] [--json]\n  voktty ipme [--public] [--json]\n  voktty --version\n\n\
Alias execution is tokenized and never evaluated by a shell. Public IP lookup only runs\n\
when ipme receives --public. App control commands require Voktty to be running."
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn args(values: &[&str]) -> Vec<OsString> {
        values.iter().map(OsString::from).collect()
    }

    #[test]
    fn parses_transport_commands() {
        let config = parse_args(args(&["ping", "--json"])).expect("parse ping");
        assert!(config.json);
        assert_eq!(
            config.action,
            Action::Request {
                method: METHOD_PING,
                params: json!({}),
            }
        );
    }

    #[test]
    fn parses_alias_run_without_reconstructing_arguments() {
        let config = parse_args(args(&[
            "alias",
            "run",
            "build",
            "--",
            "argument with spaces",
            "--flag=value",
        ]))
        .expect("parse alias run");
        assert_eq!(
            config.action,
            Action::Alias(AliasCommand::Run {
                name: "build".into(),
                args: args(&["argument with spaces", "--flag=value"]),
            })
        );
    }

    #[test]
    fn ipme_shorthand_is_an_internal_alias() {
        let config = parse_args(args(&["ipme", "--public"])).expect("parse ipme");
        assert_eq!(
            config.action,
            Action::Alias(AliasCommand::Run {
                name: "ipme".into(),
                args: args(&["--public"]),
            })
        );
    }

    #[test]
    fn alias_export_requires_force_for_an_existing_destination() {
        let command =
            parse_alias(args(&["export", "aliases.json", "--force"])).expect("parse export");
        assert_eq!(
            command,
            AliasCommand::Export {
                path: PathBuf::from("aliases.json"),
                force: true,
            }
        );
    }

    #[test]
    fn rejects_unknown_options() {
        let error = parse_args(args(&["ping", "--wat"])).expect_err("reject option");
        assert_eq!(error.exit, EXIT_USAGE);
    }

    #[test]
    fn json_flag_parsing_respects_the_option_separator() {
        let mut values = args(&["open", "--json", "--", "--json"]);
        assert!(extract_json_flag(&mut values));
        assert_eq!(values, args(&["open", "--", "--json"]));
    }

    #[test]
    fn rejects_zero_line_before_reading_path() {
        let error =
            parse_args(args(&["open", "--line", "0", "missing.rs"])).expect_err("reject zero line");
        assert_eq!(error.code, "usage");
    }

    #[test]
    fn parses_file_shorthand_with_line_and_focus_policy() {
        let file = tempfile::NamedTempFile::new().expect("temp file");
        let config = parse_args(vec![
            file.path().as_os_str().to_owned(),
            "--line".into(),
            "7".into(),
            "--no-focus".into(),
        ])
        .expect("parse open shorthand");
        let Action::Request { method, params } = config.action else {
            panic!("expected request action");
        };
        assert_eq!(method, METHOD_OPEN);
        assert_eq!(params["line"], 7);
        assert_eq!(params["focus"], false);
        assert_eq!(
            params["path"],
            std::fs::canonicalize(file.path())
                .expect("canonical temp path")
                .to_string_lossy()
                .as_ref()
        );
    }

    #[test]
    fn help_is_the_default() {
        assert_eq!(
            parse_args(Vec::new()).expect("parse default").action,
            Action::Help
        );
    }

    #[test]
    fn request_ids_are_safe_ascii() {
        let id = request_id();
        assert!(id.bytes().all(|byte| byte.is_ascii_digit() || byte == b'-'));
    }

    #[test]
    fn endpoint_validation_rejects_non_loopback_addresses() {
        assert!(parse_loopback_address("127.0.0.1:4312").is_ok());
        assert!(parse_loopback_address("[::1]:4312").is_ok());
        let error = parse_loopback_address("192.0.2.1:4312").expect_err("reject remote endpoint");
        assert_eq!(error.code, "invalid_endpoint");
    }

    #[test]
    fn endpoint_validation_requires_a_full_random_token() {
        let descriptor = ControlDescriptor {
            protocol: PROTOCOL_VERSION,
            address: "127.0.0.1:4312".into(),
            token: "short".into(),
            pid: 1,
            app_version: "test".into(),
        };
        let Err(error) = validate_endpoint(descriptor, false) else {
            panic!("accepted invalid token");
        };
        assert_eq!(error.code, "invalid_endpoint");
    }

    #[test]
    fn endpoint_validation_rejects_a_stale_descriptor_process() {
        let descriptor = ControlDescriptor {
            protocol: PROTOCOL_VERSION,
            address: "127.0.0.1:4312".into(),
            token: "a".repeat(64),
            pid: u32::MAX,
            app_version: "test".into(),
        };
        let Err(error) = validate_endpoint(descriptor, true) else {
            panic!("accepted stale process");
        };
        assert_eq!(error.code, "invalid_endpoint");
        assert!(process_is_alive(std::process::id()));
    }

    #[test]
    fn protocol_framing_round_trips_one_bounded_json_message() {
        let request = ControlRequest {
            protocol: PROTOCOL_VERSION,
            id: "transport-test".into(),
            token: "test-token".into(),
            method: METHOD_PING.into(),
            params: json!({}),
            caller: CallerContext::default(),
        };
        let response = ControlResponse::success(request.id.clone(), json!({ "pong": true }));
        let mut bytes = serde_json::to_vec(&response).expect("encode response");
        bytes.push(b'\n');
        let response = read_response(&mut Cursor::new(bytes), &request).expect("read response");
        assert_eq!(response.result, Some(json!({ "pong": true })));
    }

    #[test]
    fn protocol_framing_rejects_oversized_responses() {
        let request = ControlRequest {
            protocol: PROTOCOL_VERSION,
            id: "size-test".into(),
            token: "test-token".into(),
            method: METHOD_PING.into(),
            params: json!({}),
            caller: CallerContext::default(),
        };
        let bytes = vec![b'x'; MAX_MESSAGE_BYTES + 1];
        let error = read_response(&mut Cursor::new(bytes), &request).expect_err("reject response");
        assert_eq!(error.code, "message_too_large");
    }

    #[test]
    fn protocol_framing_accepts_server_errors_without_a_parsed_request_id() {
        let request = ControlRequest {
            protocol: PROTOCOL_VERSION,
            id: "busy-test".into(),
            token: "test-token".into(),
            method: METHOD_PING.into(),
            params: json!({}),
            caller: CallerContext::default(),
        };
        let response = ControlResponse::failure(SERVER_RESPONSE_ID, "server_busy", "busy");
        let mut bytes = serde_json::to_vec(&response).expect("encode response");
        bytes.push(b'\n');
        let response = read_response(&mut Cursor::new(bytes), &request).expect("read response");
        assert!(!response.ok);
    }
}
