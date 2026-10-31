# folio — Joel Dizon's portfolio

The portfolio at **https://folio.xtangent.ai**: profile, projects with logos and short descriptions,
contact, a light/dark switch, the MealSenseAI data-and-ML sub-project, and the LikeC4 architecture
models of **MealSenseAI** and **CEREBRO**. One static site, served by nginx on Buddy.

| Path | Contents |
|---|---|
| `/` | Portfolio: profile, projects, contact |
| `/work/mealsenseai/data-and-ml/` | MealSenseAI sub-project: data engineering, machine learning, model evaluation, with charts from the training evidence |
| `/mealsenseai/` | MealSenseAI architecture: landscape, capabilities, product rules, containers, components, Buddy, three flows |
| `/cerebro/` | CEREBRO architecture: its views, from `architecture/likec4` in the CEREBRO repository |
| `/nexus/` | NEXUS architecture: its views, from `architecture/likec4` in the NEXUS repository (development in progress) |

It used to live inside the MealSenseAI repository (`infrastructure/architecture-site`); this
repository carries its history. It is its own Compose project (`folio`) and shares no container,
network or volume with MealSenseAI or CEREBRO.

## Edit the portfolio

All the words live in `portfolio.json` and `pages/`; the layout is `index.template.html`,
`page.template.html` and the shared `site.css` (colours are tokens on `:root`, re-pointed for the
dark theme). No HTML is needed to change content. `tools/evidence_charts.py` turns MealSenseAI's
training evidence into `pages/mealsenseai-ml.charts.json`.

The architecture pages are built from the product repositories, so a model changes there, not here.

## Set up on Buddy

```bash
cd ~ && git clone https://github.com/dizonj-lab/folio.git
cd ~/folio && ./setup.sh
```

The script:

1. finds the models — MealSenseAI in `MEALSENSE_DIR` (default `~/MealSenseAI`), CEREBRO in
   `CEREBRO_DIR` (default `~/cerebro`), NEXUS in `NEXUS_DIR` (default `~/nexus`); a missing one is
   left out rather than failing the site;
2. serves on `127.0.0.1:8095` (on its first run it carries over the old copy's port, from
   `$MEALSENSE_DIR/infrastructure/architecture-site/.env`);
3. stops the old copy's nginx (Compose project `architecture`; containers only, no volumes removed)
   so this one can take the port;
4. builds the site with LikeC4 `1.60.0` in a throwaway Node container, then starts nginx and checks
   `/healthz`.

Settings are saved in `.env` (git-ignored), so later runs need no arguments. To override:
`MEALSENSE_DIR=… CEREBRO_DIR=… ARCH_BIND=… ARCH_PORT=… ./setup.sh`.

## Demo videos

`setup.sh` publishes the newest `~/cerebro-demo-*/CEREBRO-demo.mp4` and
`~/mealsense-demo-*/MealSenseAI-demo.mp4` (made by each product's `demo/run.sh`), or the files in
`DEMO_VIDEO` and `MEALSENSE_DEMO_VIDEO`, at `/media/<product>-demo.mp4` with subtitles as `.vtt`,
and a player page at `/demo/<product>/`. The card then shows "Watch demo". Photo credits that came
with a video (`PHOTO-CREDITS.md`) are listed under its player. The videos are copied into `media/`
and never committed. `/media/` is served with CORS so CEREBRO's own landing page can play its video.

## Update

```bash
cd ~/folio && git pull && ./setup.sh
```

Also after a model changes: `git pull` in `~/MealSenseAI`, `~/cerebro` or `~/nexus` first. nginx keeps serving
the previous site until the new build is complete.

## Who can reach it

Public, through the Cloudflare Tunnel's hostname `folio.xtangent.ai`, whose service is
`http://127.0.0.1:8095`: cloudflared runs on Buddy itself. The port is bound to loopback
(`ARCH_BIND`, default `127.0.0.1`), so nothing else on the network reaches it directly and nothing
on the router is forwarded; never `0.0.0.0`, because Docker publishes ports outside UFW. If the port
ever changes, change the tunnel's public hostname to match. To look at it from another machine on
the LAN, use an SSH tunnel (`ssh -L 8095:127.0.0.1:8095 buddy`) rather than widening the binding.

Only what is meant to be public belongs here: no secrets, internal addresses or credentials in
`portfolio.json`, `pages/` or either model.
