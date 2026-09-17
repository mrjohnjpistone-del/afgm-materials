# Set-Build Materials List

A shared shopping/build list for a stage production. Two pages, two levels of access:

- **The list** `/` — anyone with the link can see everything and **add** items.
  New items always land as *Needed*. No key, no login, works on any phone.
- **Manage the list** `/manage` — enter the access key to **change**, **remove**
  and **undo**. Also where the title, the intro line and the key itself are edited.

Both pages group the list by **what each item is for** (Jessup's desk, the judge's
box, the balcony…), by type of material, or by status; search it, sort it, print
it, or download it as a spreadsheet.

No database service. No `npm install` — it's plain Node.js, so there's nothing to
break on deploy. The list persists to a JSON file.

---

## Run it on your own computer

```bash
node server.js
```

Then open <http://localhost:3000> (the list) and <http://localhost:3000/manage>
(editing). The starting access key is printed in the terminal.

---

## Put it online — Render

`render.yaml` describes the whole service. On <https://render.com> choose
**New → Blueprint**, point it at this repo, set `MATERIALS_KEY` to whatever key
the build lead should use, and Apply.

### Keeping the list when the service sleeps

A **free** Render service wipes its filesystem every time it sleeps or redeploys.
Two ways to keep the list:

1. **Paid ($7/mo Starter) + a 1 GB disk** mounted at `/var/data`, with
   `DATA_DIR=/var/data`. Nothing else to configure.
2. **Free + an off-box mirror.** Set `BACKUP_URL` and `BACKUP_KEY` to a key-gated
   endpoint that stores one JSON blob (`GET` returns it, `PUT` replaces it). After
   every change the whole list is pushed there — debounced, and flushed on
   shutdown — and a machine that boots with an empty disk restores from it before
   anyone sees the page. Leave both unset and the app is entirely self-contained.

---

## Endpoints

| Method | Path | Key? | What it does |
|--------|------|------|--------------|
| GET | `/api/list` | no | the list, plus the category / status / area pick-lists |
| GET | `/api/list.csv` | no | the list as a spreadsheet |
| POST | `/api/items` | no | add an item (rate limited, always saved as *Needed*) |
| GET | `/api/staff/list` | yes | the list **and** the undo bin |
| PATCH | `/api/staff/items/:id` | yes | edit an item — send only the fields that changed |
| DELETE | `/api/staff/items/:id` | yes | remove an item (kept in the undo bin) |
| POST | `/api/staff/restore` | yes | undo a removal |
| POST | `/api/staff/settings` | yes | change the title / intro line |
| POST | `/api/staff/key` | yes | rotate the access key |

The key travels as an `x-staff-key` header (or `?key=` for a one-click link).

## Configuration

| Variable | Default | Meaning |
|----------|---------|---------|
| `PORT` | `3000` | Port to listen on (Render sets this). |
| `MATERIALS_KEY` | built-in default | The access key for `/manage`. Set your own. |
| `DATA_DIR` | `./data` | Folder for the JSON data file. |
| `BACKUP_URL` | *(unset)* | Optional mirror endpoint — see above. |
| `BACKUP_KEY` | *(unset)* | Key sent to that endpoint. |

## How it's built

- `server.js` — a Node `http` server with zero dependencies.
- Writes are atomic (temp file + rename) and serialized, so two people adding at
  the same moment can't corrupt the file.
- Every field is coerced server-side; links are accepted only if they're `http(s)`,
  and every value is escaped when rendered — a pasted `<script>` shows as text.
- The public page can only *add*. Status, edits and removals are key-gated, so a
  shared link can't be used to wipe the list.
