<?php
// Router for PHP's built-in server, used by the integrated live preview.
// It answers every request itself and never returns false: with
// auto_append_file or a false return, the server emits bytes before the
// response headers of static files, which breaks CSS, scripts and images.

function voktty_wants_injection() {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'HEAD') {
        return false;
    }
    $accept = $_SERVER['HTTP_ACCEPT'] ?? '';
    if ($accept !== '' && stripos($accept, 'text/html') === false) {
        return false;
    }
    $status = http_response_code();
    if ($status === 204 || $status === 304 || ($status >= 300 && $status < 400)) {
        return false;
    }
    foreach (headers_list() as $header) {
        if (stripos($header, 'Content-Type:') === 0) {
            return stripos($header, 'text/html') !== false;
        }
    }
    return true;
}

function voktty_inject($buffer) {
    if (!is_string($buffer) || $buffer === '' || !voktty_wants_injection()) {
        return $buffer;
    }
    // A framed preview cannot show pages that forbid framing, such as the
    // WordPress login.
    header_remove('X-Frame-Options');
    if (strpos($buffer, '__voktty_inspector.js') !== false) {
        return $buffer;
    }
    $script = '<script src="/__voktty_inspector.js"></script>';
    $pos = strripos($buffer, '</body>');
    if ($pos !== false) {
        return substr_replace($buffer, $script . '</body>', $pos, 7);
    }
    $pos = strripos($buffer, '</html>');
    if ($pos !== false) {
        return substr_replace($buffer, $script . '</html>', $pos, 7);
    }
    return $buffer . "\n" . $script;
}

function voktty_fail($code, $message) {
    http_response_code($code);
    header('Content-Type: text/plain; charset=utf-8');
    echo $message;
    exit;
}

function voktty_mime($path) {
    static $types = [
        'css' => 'text/css; charset=utf-8',
        'js' => 'text/javascript; charset=utf-8',
        'mjs' => 'text/javascript; charset=utf-8',
        'json' => 'application/json; charset=utf-8',
        'map' => 'application/json; charset=utf-8',
        'svg' => 'image/svg+xml',
        'png' => 'image/png',
        'jpg' => 'image/jpeg',
        'jpeg' => 'image/jpeg',
        'gif' => 'image/gif',
        'webp' => 'image/webp',
        'avif' => 'image/avif',
        'ico' => 'image/x-icon',
        'woff' => 'font/woff',
        'woff2' => 'font/woff2',
        'ttf' => 'font/ttf',
        'otf' => 'font/otf',
        'eot' => 'application/vnd.ms-fontobject',
        'mp4' => 'video/mp4',
        'webm' => 'video/webm',
        'mp3' => 'audio/mpeg',
        'wav' => 'audio/wav',
        'wasm' => 'application/wasm',
        'pdf' => 'application/pdf',
        'xml' => 'application/xml; charset=utf-8',
        'txt' => 'text/plain; charset=utf-8',
        'csv' => 'text/csv; charset=utf-8',
        'md' => 'text/plain; charset=utf-8',
    ];
    $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
    if (isset($types[$ext])) {
        return $types[$ext];
    }
    if (function_exists('mime_content_type')) {
        $detected = @mime_content_type($path);
        if (is_string($detected) && $detected !== '') {
            return $detected;
        }
    }
    return 'application/octet-stream';
}

function voktty_run_php($file, $scriptName, $pathInfo = null) {
    $_SERVER['SCRIPT_NAME'] = $scriptName;
    $_SERVER['PHP_SELF'] = $scriptName . ($pathInfo ?? '');
    $_SERVER['SCRIPT_FILENAME'] = $file;
    $_SERVER['DOCUMENT_URI'] = $scriptName;
    if ($pathInfo !== null) {
        $_SERVER['PATH_INFO'] = $pathInfo;
    }
    chdir(dirname($file));
    ob_start('voktty_inject');
    include $file;
    exit;
}

$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
if (!is_string($uri) || $uri === '') {
    $uri = '/';
}

if ($uri === '/__voktty_inspector.js') {
    header('Content-Type: application/javascript; charset=utf-8');
    header('Access-Control-Allow-Origin: *');
    header('Cache-Control: no-cache, no-store, must-revalidate');
    readfile(__DIR__ . '/voktty_inspector.js');
    exit;
}

$docroot = realpath($_SERVER['DOCUMENT_ROOT'] ?? getcwd());
if ($docroot === false) {
    voktty_fail(500, 'Document root is not available.');
}

$decoded = rawurldecode($uri);
if (strpos($decoded, "\0") !== false) {
    voktty_fail(400, 'Bad request.');
}
foreach (explode('/', str_replace('\\', '/', $decoded)) as $segment) {
    if ($segment === '..') {
        voktty_fail(403, 'Forbidden.');
    }
}

function voktty_inside_root($path, $docroot) {
    return $path === $docroot || strpos($path, $docroot . DIRECTORY_SEPARATOR) === 0;
}

$candidate = realpath($docroot . $decoded);

if ($candidate !== false && !voktty_inside_root($candidate, $docroot)) {
    voktty_fail(403, 'Forbidden.');
}

if ($candidate !== false && is_dir($candidate)) {
    foreach (['index.php', 'index.html', 'index.htm'] as $index) {
        if (is_file($candidate . DIRECTORY_SEPARATOR . $index)) {
            $candidate = $candidate . DIRECTORY_SEPARATOR . $index;
            $decoded = rtrim($decoded, '/') . '/' . $index;
            break;
        }
    }
}

if ($candidate !== false && is_file($candidate)) {
    $ext = strtolower(pathinfo($candidate, PATHINFO_EXTENSION));
    if ($ext === 'php') {
        voktty_run_php($candidate, $decoded);
    }
    if ($ext === 'html' || $ext === 'htm') {
        header('Content-Type: text/html; charset=utf-8');
        header('Access-Control-Allow-Origin: *');
        echo voktty_inject((string) file_get_contents($candidate));
        exit;
    }
    header('Content-Type: ' . voktty_mime($candidate));
    header('Content-Length: ' . filesize($candidate));
    readfile($candidate);
    exit;
}

// /script.php/extra/path: the script runs with the rest as PATH_INFO.
if (preg_match('#^(.+?\.php)(/.*)$#i', $decoded, $parts)) {
    $script = realpath($docroot . $parts[1]);
    if ($script !== false && is_file($script) && voktty_inside_root($script, $docroot)) {
        voktty_run_php($script, $parts[1], $parts[2]);
    }
}

// Pretty URLs (WordPress, Laravel, Symfony, Slim, CodeIgniter): any other
// path goes to the front controller, but a missing asset stays a 404.
$assetPattern = '#\.(?:css|js|mjs|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|wasm|pdf)$#i';
$front = $docroot . DIRECTORY_SEPARATOR . 'index.php';
if (is_file($front) && !preg_match($assetPattern, $decoded)) {
    voktty_run_php($front, '/index.php');
}

voktty_fail(404, 'Not found.');
