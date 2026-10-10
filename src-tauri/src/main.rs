// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Some(code) = voktty_lib::modules::harness::ssh_askpass::maybe_run() {
        std::process::exit(code);
    }

    #[cfg(target_os = "macos")]
    {
        // Disable macOS press-and-hold character popup, so key repeat works in terminal.
        use objc2::msg_send;
        use objc2::rc::Retained;
        use objc2_foundation::{ns_string, NSDictionary, NSNumber, NSString, NSUserDefaults};
        let key = NSString::from_str("WebContinuousSpellCheckingEnabled");
        let enabled = NSNumber::numberWithBool(true);
        let spellcheck_defaults: Retained<NSDictionary<NSString>> =
            NSDictionary::from_slices(&[&*key], &[enabled.as_ref()]);
        unsafe {
            let defaults = NSUserDefaults::standardUserDefaults();
            let key = ns_string!("ApplePressAndHoldEnabled");
            let _: () = msg_send![&defaults, setBool: false, forKey: key];
            defaults.registerDefaults(&spellcheck_defaults);
        }
    }

    voktty_lib::run()
}
