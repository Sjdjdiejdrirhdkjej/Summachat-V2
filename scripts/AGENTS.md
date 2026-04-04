## OVERVIEW

Standalone TypeScript utility scripts. Run via `tsx` directly, not as packages.

## WHERE TO LOOK

- `src/` for script files
- `post-merge.sh` for git post-merge hook (runs `npm ci` + `db push`)

## CONVENTIONS

- Run scripts: `npm run -w @workspace/scripts <script-name>`
- Uses `tsx` to execute TypeScript directly
- Scripts are one-off utilities, not part of app/lib packages

## SCRIPTS

- `hello` — Example script (template for new scripts)

## NOTES

- Post-merge hook runs automatically after `git pull` with merge
- Add new scripts to `package.json` scripts section
