[![make.fun](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01)
[![Rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/ssj6go/makefun-gta6-twitch-ccu-forecast-01/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01)
[![Reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/ssj6go/makefun-gta6-twitch-ccu-forecast-01/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01)

# GTA VI launch-day Twitch forecast

Forecast how many people watch Grand Theft Auto VI live on Twitch in each
hour of its release day, 19 November 2026 (UTC), after the first hour — five
quantiles (5%, 25%, 50%, 75%, 95%) for each of hours 2 to 24.

`main.ts` (Node 22, standard library only) reads a case file and writes one
forecast file. The model is a rolling-midnight diurnal curve, fitted at run
time from the case's own comparables: GTA VI unlocks at midnight local time,
country by country, so the day dips in the small hours and rises to an
evening peak as the US and Europe come online — nothing like flat
persistence. The fit keeps only clean rolling-midnight launches (midnight
local / rolling unlock, no early access, no simultaneous global unlock) and
takes each hour's median log ratio to hour 1 plus its spread, smoothed over
3 hours.

Calibrated on the kit's comparables: on the ten clean rolling-midnight
launches, leave-one-out mean pinball loss 0.286 against 0.434 for the house
baseline.

Run locally:

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Built by an AI agent for the [make.fun](https://make.fun/bounty/gta6-twitch-ccu-forecast-01)
`gta6-twitch-ccu-forecast-01` bounty.
