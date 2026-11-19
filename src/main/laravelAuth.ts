import { exec } from './exec'

/**
 * "Log in as…" for Laravel apps, without touching the app's code.
 *
 * Spindle runs a tiny PHP script inside the project that boots the app and either lists users
 * (from the configured auth provider's model) or logs one in through Laravel's own session guard —
 * the same `login()` a login form calls — saves the session to the app's session store, and returns
 * the session cookie encrypted the way the EncryptCookies middleware expects. Spindle puts that
 * cookie into the preview's cookie jar, so the preview is simply logged in.
 *
 * Works with any session-based default guard (Breeze, Jetstream, Fortify, Filament, custom) and the
 * file / database / redis / memcached session drivers. Refuses on production environments.
 */
export const AUTH_SCRIPT = String.raw`<?php
// Spindle "log in as" helper. Usage: php spindle-auth.php <project root> list [search] | login <id>
$root = $argv[1] ?? getcwd();
$action = $argv[2] ?? 'list';
function spindle_out($d) { fwrite(STDOUT, "\n__SPINDLE__" . json_encode($d) . "\n"); exit(0); }
function spindle_fail($m) { spindle_out(['error' => $m]); }
if (!file_exists($root . '/vendor/autoload.php')) spindle_fail('Dependencies aren’t installed yet (vendor/ is missing).');
chdir($root);
require $root . '/vendor/autoload.php';
$app = require $root . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

if ($app->environment('production')) spindle_fail('This is a production environment — Spindle won’t log in here.');
$guardName = config('auth.defaults.guard', 'web');
$guard = auth()->guard($guardName);
if (!method_exists($guard, 'login') || !method_exists($guard, 'getProvider')) spindle_fail("The default guard ($guardName) doesn’t use sessions.");
$provider = $guard->getProvider();
$model = method_exists($provider, 'getModel') ? $provider->getModel() : null;
if (!$model || !class_exists($model)) spindle_fail('No Eloquent user model is configured (config/auth.php → providers).');

if ($action === 'list') {
    $q = trim($argv[3] ?? '');
    $instance = new $model;
    $key = $instance->getKeyName();
    $cols = Illuminate\Support\Facades\Schema::connection($instance->getConnectionName())->getColumnListing($instance->getTable());
    $wanted = ['name', 'first_name', 'last_name', 'username', 'email', 'role', 'type', 'is_admin', 'admin'];
    $pick = array_values(array_intersect($wanted, $cols));
    $query = $model::query();
    if ($q !== '') {
        $query->where(function ($w) use ($q, $cols, $key) {
            foreach (['name', 'email', 'username', 'first_name', 'last_name'] as $c) if (in_array($c, $cols)) $w->orWhere($c, 'like', '%' . $q . '%');
            if (ctype_digit($q)) $w->orWhere($key, (int) $q);
        });
    }
    $rows = $query->orderBy($key)->limit(100)->get(array_merge([$key], $pick));
    spindle_out([
        'total' => $model::query()->count(),
        'users' => $rows->map(function ($u) {
            $a = $u->getAttributes();
            $name = trim((string) ($a['name'] ?? '')) ?: trim(($a['first_name'] ?? '') . ' ' . ($a['last_name'] ?? '')) ?: (string) ($a['username'] ?? '');
            $role = $a['role'] ?? $a['type'] ?? ((!empty($a['is_admin']) || !empty($a['admin'])) ? 'admin' : null);
            return ['id' => (string) $u->getKey(), 'name' => $name, 'email' => $a['email'] ?? null, 'role' => is_scalar($role) ? (string) $role : null];
        })->values(),
    ]);
}

if ($action === 'login') {
    $user = $provider->retrieveById($argv[3] ?? '');
    if (!$user) spindle_fail('That user doesn’t exist any more.');
    $driver = config('session.driver');
    if (in_array($driver, ['array', 'cookie'])) spindle_fail("Sessions use the “$driver” driver, which can’t be prepared outside a request. Set SESSION_DRIVER to file or database in .env.");
    $session = app('session')->driver();
    $session->start();
    $guard->login($user); // what a login form does: stores the user id and regenerates the session
    $session->save();
    $name = config('session.cookie');
    $value = $session->getId();
    // Encrypt like EncryptCookies does (unless the app opted the session cookie out).
    $encrypt = true;
    foreach (['App\Http\Middleware\EncryptCookies', 'Illuminate\Cookie\Middleware\EncryptCookies'] as $cls) {
        if (class_exists($cls)) {
            try { $encrypt = !app($cls)->isDisabled($name); } catch (Throwable $e) {}
            break;
        }
    }
    if ($encrypt) {
        $encrypter = app('encrypter');
        if (class_exists('Illuminate\Cookie\CookieValuePrefix')) $value = Illuminate\Cookie\CookieValuePrefix::create($name, $encrypter->getKey()) . $value;
        $value = $encrypter->encrypt($value, false);
    }
    $route = Illuminate\Support\Facades\Route::class;
    $home = $route::has('dashboard') ? route('dashboard', [], false) : ($route::has('home') ? route('home', [], false) : '/');
    spindle_out([
        'cookie' => ['name' => $name, 'value' => $value, 'path' => config('session.path') ?: '/', 'httpOnly' => (bool) config('session.http_only', true), 'sameSite' => strtolower((string) (config('session.same_site') ?: 'lax')), 'lifetimeMinutes' => (int) config('session.lifetime', 120)],
        'user' => ['id' => (string) $user->getAuthIdentifier(), 'name' => $user->name ?? null, 'email' => $user->email ?? null],
        'home' => $home,
    ]);
}
spindle_fail('Unknown action');
`

export interface AuthUser {
  id: string
  name: string
  email: string | null
  role: string | null
}

/** Pull the JSON line out of the script's output (the app may print warnings around it). */
export function parseAuthOutput<T>(stdout: string, stderr = ''): T {
  const line = stdout.split('\n').reverse().find((l) => l.startsWith('__SPINDLE__'))
  if (!line) throw new Error(`Couldn’t read the app’s users: ${(stderr || stdout).trim().split('\n').slice(-3).join(' ') || 'no output'}`)
  const data = JSON.parse(line.slice('__SPINDLE__'.length)) as T & { error?: string }
  if (data.error) throw new Error(data.error)
  return data
}

export async function runAuthScript<T>(script: string, root: string, args: string[], env: Record<string, string>): Promise<T> {
  const r = await exec('php', [script, root, ...args], { cwd: root, env, timeoutMs: 30_000 })
  return parseAuthOutput<T>(r.stdout, r.stderr)
}
