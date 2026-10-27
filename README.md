# Study Desk

Track study time per topic, run pomodoros, plan tasks on an Eisenhower matrix and see your history by day, week, month and year. Every user has their own account, and all data is stored in a SQLite database.

## Download

Get the latest installer from the [Releases page](../../releases/latest):

| Platform | File |
| --- | --- |
| Windows 10/11 | `Study-Desk-<version>-win-x64.exe` |
| macOS, Apple Silicon (M1 and later) | `Study-Desk-<version>-mac-arm64.dmg` |
| macOS, Intel | `Study-Desk-<version>-mac-x64.dmg` |

The installers are not code-signed, so the first launch needs one extra step:

- **Windows:** if SmartScreen says "Windows protected your PC", click **More info → Run anyway**.
- **macOS:** open the `.dmg` and drag Study Desk to Applications. The first time, right-click the app and choose **Open**. If macOS still blocks it, go to **System Settings → Privacy & Security** and click **Open Anyway**. If it says the app "is damaged", run `xattr -cr "/Applications/Study Desk.app"` in Terminal once.

## Features

- **Accounts:** sign up, sign in, sign out, change password (signs out your other devices), delete account.
- **Topics:** daily goals with live timers, pause/resume, and a goal-reached alert.
- **Pomodoro:** focus and break timers that count toward a topic, with loud alerts and a pop-out always-on-top timer.
- **Matrix and To-do:** one shared task list, sorted into urgent/important quadrants.
- **Stats:** day timeline, week timeline or stacked bars, month and year calendars; add, edit and delete sessions by hand.
- **Backup:** download or copy your data as JSON and restore it later. Backups from the original single-file Study Desk can be restored too.

## Where your data lives

The desktop app has two modes, chosen on the sign-in screen or under **Account → Server → Change**:

- **This computer (default):** the app runs a small private server inside itself. Accounts and data are kept in `studydesk.sqlite` in the app's data folder (`%APPDATA%\Study Desk` on Windows, `~/Library/Application Support/Study Desk` on macOS). Nothing leaves your computer.
- **A Study Desk server:** enter the address of a server you host (see below) to use the same account on several computers or in a web browser. Changes sync automatically. If two devices change data at the same moment, the most recent saved version wins and the other device reloads it.

## Run your own server (sync across devices)

The server is the same Node.js app without the desktop shell. It serves the web version and the API.

```bash
npm ci --omit=dev
npm run server            # http://localhost:8080
```

Or with Docker:

```bash
docker build -t study-desk .
docker run -d -p 8080:8080 -v studydesk-data:/data study-desk
```

Environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | Port to listen on |
| `DATA_DIR` | `./data` | Folder for `studydesk.sqlite` |
| `ALLOW_SIGNUP` | `true` | Set to `false` to stop new accounts after yours is created |
| `TRUST_PROXY` | unset | Set to `1` behind a reverse proxy that terminates HTTPS, so login cookies are marked secure |

Put the server behind HTTPS (for example Caddy, nginx or a hosting platform) before using it over the internet. Back up `studydesk.sqlite` to back up every account.

## Development

```bash
npm install
npm start          # run the desktop app
npm run server     # run only the web server
npm test           # API tests
npm run dist:win   # build the Windows installer into dist/
npm run dist:mac   # build the macOS disk images (must run on a Mac)
```

Project layout:

```
electron/   desktop shell (window, pop-out timer, server switching)
server/     Express API, accounts and the SQLite database (sql.js)
public/     the web app (HTML, CSS, JavaScript)
test/       API tests
scripts/    icon generator
```

### Security notes

- Passwords are hashed with scrypt and a per-user salt. Sessions use random tokens kept in an HttpOnly, SameSite cookie, and only a hash of each token is stored.
- State-changing requests need a custom header, which blocks cross-site request forgery.
- Repeated failed password attempts from one address are limited.
- The desktop app's built-in server listens on `127.0.0.1` only and rejects requests for other host names.

### Releasing

Push a version tag. GitHub Actions runs the tests, builds the Windows and macOS installers and attaches them to a new release:

```bash
git tag v1.0.1
git push origin v1.0.1
```

## License

MIT
