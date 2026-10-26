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
   `CEREBRO_DIR` (default `~/cerebro`); a missing one is left out rather than failing the site;
2. on its first run, carries over the address and port the old copy used (from
   `$MEALSENSE_DIR/infrastructure/architecture-site/.env`), because that is what Cloudflare points at;
3. stops the old copy's nginx (Compose project `architecture`; containers only, no volumes removed)
   so this one can take the port;
4. builds the site with LikeC4 `1.60.0` in a throwaway Node container, then starts nginx and checks
   `/healthz`.

Settings are saved in `.env` (git-ignored), so later runs need no arguments. To override:
`MEALSENSE_DIR=… CEREBRO_DIR=… ARCH_BIND=… ARCH_PORT=… ./setup.sh`.

## Update

```bash
cd ~/folio && git pull && ./setup.sh
```

Also after a model changes: `git pull` in `~/MealSenseAI` or `~/cerebro` first. nginx keeps serving
the previous site until the new build is complete.

## Who can reach it

Public, through the Cloudflare Tunnel's hostname `folio.xtangent.ai`, whose service points at this
site's address and port. Nothing on the router is forwarded. The port is bound to one address
(`ARCH_BIND`), never `0.0.0.0`, because Docker publishes ports outside UFW. If the port or address
ever changes, change the tunnel's public hostname to match.

Only what is meant to be public belongs here: no secrets, internal addresses or credentials in
`portfolio.json`, `pages/` or either model.
