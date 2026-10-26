# Portfolio and architecture site on the home server

A professional portfolio page with the LikeC4 architecture models of **MealSenseAI** and
**CEREBRO**, served as one static website on Buddy's home network:

| URL | Contents |
|---|---|
| `http://192.168.1.25:8095/` | Portfolio: profile, projects with logos and descriptions, contact |
| `http://192.168.1.25:8095/mealsenseai/` | MealSenseAI: landscape, capabilities, product rules, containers, backend components, Buddy, and three flows (photo to nutrition, glucose estimate, Meal Advisor) |
| `http://192.168.1.25:8095/cerebro/` | CEREBRO: its 16 views, from `architecture/likec4` on the `cerebro-mvp` branch |

It is a separate Compose project (`architecture`), so it never touches the MealSenseAI or CEREBRO
containers, databases or volumes.

## Set up

On Buddy, with both repositories cloned (MealSenseAI where you deploy it from, CEREBRO at
`~/cerebro` on the `cerebro-mvp` branch):

```bash
cd ~/MealSenseAI            # wherever this repository lives on Buddy
git pull
./infrastructure/architecture-site/setup.sh
```

The script:

1. works out Buddy's LAN address (or takes `ARCH_BIND=192.168.1.25`) and refuses `0.0.0.0`;
2. checks the port (default `8095`, or `ARCH_PORT=…`) is free;
3. finds the CEREBRO model in `CEREBRO_DIR` (default `~/cerebro`); if it is missing, it builds the
   MealSenseAI model alone and tells you how to add CEREBRO;
4. builds both models with LikeC4 `1.60.0` in a throwaway Node container, then starts nginx.

Settings are saved in `infrastructure/architecture-site/.env`, so later runs need no arguments.

## Update after a model changes

```bash
cd ~/cerebro && git pull                      # if the CEREBRO model changed
cd ~/MealSenseAI && git pull && ./infrastructure/architecture-site/setup.sh
```

Only the build reruns; nginx keeps serving the previous site until the new one is complete.

## Who can reach it

The port is bound to the LAN address only. Docker publishes ports outside UFW, which is why it is
never bound to every interface: devices on your home network can open it, and nothing outside the
house can, because no router port is forwarded. It is **not** published through the Cloudflare
Tunnel. To reach it over Tailscale too, run once with `ARCH_BIND=<Buddy's Tailscale IP>` instead.

If you later want it on the internet, add a hostname to the existing tunnel and put it behind
Cloudflare Access (email login); do not publish it without Access.

## Edit the portfolio

All the page's words live in `portfolio.json`; the layout is `index.template.html`. No HTML is
needed to change content.

- **Add a project:** append an entry to `projects` (`slug`, `name`, `tagline`, `description`, and
  optionally `logo`, `logoTile`, `highlights`, `stack`, `status`, `context`, `links`). Without a
  `logo` the card shows the project's initials.
- **Logo:** put the file in `brand/` and set `"logo": "brand/<file>"`. Set `"logoTile": true` for a
  mark drawn in dark ink, so it stays visible on the dark theme.
- **Architecture link:** added automatically when a LikeC4 model named after the `slug` is built.
  To add one, mount the model at `/models/<slug>` in `docker-compose.yml`.

Then rerun `./infrastructure/architecture-site/setup.sh`.

## Edit the models

| Model | Source |
|---|---|
| MealSenseAI | `architecture/likec4/` in this repository |
| CEREBRO | `architecture/likec4/` in the CEREBRO repository |

Preview while editing, on any machine with Node 18+:

```bash
npx likec4@1.60.0 start architecture/likec4      # live preview in the browser
npx likec4@1.60.0 validate architecture/likec4   # what the site build checks first
```

## Stop it

```bash
cd infrastructure/architecture-site && docker compose down
```

The built site lives in the `architecture_site` volume and is rebuilt by `setup.sh` at any time.
