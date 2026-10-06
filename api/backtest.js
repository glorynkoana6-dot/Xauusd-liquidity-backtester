/* ============================================================
   MKAYFX XAU/USD LIQUIDITY RAID BACKTESTER V1
   /api/backtest.js

   DATA ENGINE
   -----------
   TWELVE_DATA_API_KEY_4 ONLY

   STRATEGY
   --------
   Reconstruct historical liquidity pools using ONLY information
   available at that point in time.

   HIGH liquidity:
   Price below HIGH pool + raid pressure >= threshold
   => BUY toward liquidity

   LOW liquidity:
   Price above LOW pool + raid pressure >= threshold
   => SELL toward liquidity

   DEFAULT RULE
   ------------
   Raid Strength >= 70

   ENTRY
   -----
   Signal calculated after completed M5 candle.
   Entry occurs at NEXT M5 OPEN.

   IMPORTANT
   ---------
   This is a historical reconstruction.

   It intentionally does NOT use future candles when calculating
   the signal.

   OHLC cannot reveal exact tick ordering inside one candle.
   If SL and TP are both touched during the same candle,
   default collision handling is SL FIRST.

   ENVIRONMENT
   -----------
   TWELVE_DATA_API_KEY_4
============================================================ */


/* ============================================================
   CONFIG
============================================================ */

const SYMBOL = "XAU/USD";

const TD_BASE =
  "https://api.twelvedata.com/time_series";

const TD_KEY =
  String(
    process.env.TWELVE_DATA_API_KEY_4 ||
    ""
  ).trim();


/* ============================================================
   API HANDLER
============================================================ */

export default async function handler(req, res) {

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  res.setHeader(
    "Cache-Control",
    "no-store, max-age=0"
  );


  if (req.method === "OPTIONS") {

    return res
      .status(204)
      .end();

  }


  if (req.method !== "GET") {

    return res
      .status(405)
      .json({

        ok: false,
        error: "GET only"

      });

  }


  if (!TD_KEY) {

    return res
      .status(500)
      .json({

        ok: false,

        error:
          "Add TWELVE_DATA_API_KEY_4 in Vercel."

      });

  }


  try {

    const settings =
      parseSettings(
        req.query || {}
      );


    const bars =
      await fetchHistoricalM5(
        settings.outputsize
      );


    if (bars.length < 500) {

      throw new Error(
        `Only ${bars.length} M5 candles received. Need at least 500.`
      );

    }


    const result =
      runBacktest(
        bars,
        settings
      );


    return res
      .status(200)
      .json({

        ok: true,

        symbol:
          SYMBOL,

        generatedAt:
          new Date().toISOString(),

        provider:
          "Twelve Data",

        apiEngine:
          4,

        apiVariable:
          "TWELVE_DATA_API_KEY_4",

        barsReceived:
          bars.length,

        firstBar:
          bars[0]
            ?.time
            ?.toISOString(),

        lastBar:
          bars.at(-1)
            ?.time
            ?.toISOString(),

        settings,

        ...result,

        warnings: [

          "Raid Strength is a heuristic score rather than a calibrated probability.",

          "Historical results do not guarantee future profitability.",

          "The backtester calculates signals only from information available before entry.",

          "M5 data is resampled into M15, H1 and H4 historical context.",

          "Spot XAU/USD volume may be absent or provider-specific.",

          "Same-candle TP/SL collisions default to SL-first for conservative testing."

        ]

      });


  } catch (error) {

    console.error(
      "BACKTEST ERROR",
      error
    );


    return res
      .status(500)
      .json({

        ok: false,

        symbol:
          SYMBOL,

        error:
          error?.message ||
          "Unknown backtest error"

      });

  }

}


/* ============================================================
   SETTINGS
============================================================ */

function parseSettings(query) {

  return {

    outputsize:
      intSetting(
        query.outputsize,
        5000,
        600,
        5000
      ),


    minRaidScore:
      numberSetting(
        query.minRaidScore,
        70,
        0,
        100
      ),


    minLiquidityStrength:
      numberSetting(
        query.minLiquidityStrength,
        0,
        0,
        100
      ),


    minCombinedQuality:
      numberSetting(
        query.minCombinedQuality,
        0,
        0,
        100
      ),


    maxDistanceAtr:
      numberSetting(
        query.maxDistanceAtr,
        2.0,
        0.05,
        10
      ),


    stopAtr:
      numberSetting(
        query.stopAtr,
        1.25,
        0.1,
        10
      ),


    rr:
      numberSetting(
        query.rr,
        1.5,
        0.25,
        10
      ),


    riskPct:
      numberSetting(
        query.riskPct,
        1,
        0.05,
        20
      ),


    startingBalance:
      numberSetting(
        query.startingBalance,
        10000,
        10,
        100000000
      ),


    spread:
      numberSetting(
        query.spread,
        0.20,
        0,
        20
      ),


    slippage:
      numberSetting(
        query.slippage,
        0.05,
        0,
        10
      ),


    cooldownBars:
      intSetting(
        query.cooldownBars,
        3,
        0,
        500
      ),


    maxTrades:
      intSetting(
        query.maxTrades,
        1000,
        1,
        10000
      ),


    oneTradeAtATime:
      boolSetting(
        query.oneTradeAtATime,
        true
      ),


    allowDormant:
      boolSetting(
        query.allowDormant,
        false
      ),


    tradeSide:
      enumSetting(

        query.tradeSide,

        [
          "BOTH",
          "BUY",
          "SELL"
        ],

        "BOTH"

      ),


    targetMode:
      enumSetting(

        query.targetMode,

        [
          "FIXED_RR",
          "LIQUIDITY",
          "SWEEP"
        ],

        "FIXED_RR"

      ),


    sessionFilter:
      enumSetting(

        query.sessionFilter,

        [
          "ALL",
          "ASIA",
          "LONDON",
          "NEW_YORK",
          "LONDON_NY"
        ],

        "ALL"

      ),


    collisionMode:
      enumSetting(

        query.collisionMode,

        [
          "SL_FIRST",
          "TP_FIRST"
        ],

        "SL_FIRST"

      ),


    minimumBars:
      300

  };

}


/* ============================================================
   FETCH M5 DATA — API 4
============================================================ */

async function fetchHistoricalM5(outputsize) {

  const url =

    `${TD_BASE}` +

    `?symbol=${encodeURIComponent(SYMBOL)}` +

    `&interval=5min` +

    `&outputsize=${encodeURIComponent(outputsize)}` +

    `&timezone=UTC` +

    `&format=JSON` +

    `&apikey=${encodeURIComponent(TD_KEY)}`;


  const response =
    await fetch(
      url,
      {
        cache: "no-store",
        headers: {
          Accept: "application/json"
        }
      }
    );


  const text =
    await response.text();


  let json;


  try {

    json =
      JSON.parse(text);

  } catch {

    throw new Error(
      "Twelve Data returned invalid JSON."
    );

  }


  if (response.status === 429) {

    throw new Error(
      json?.message ||
      "API 4 Twelve Data rate limit reached."
    );

  }


  if (!response.ok) {

    throw new Error(

      `Twelve Data HTTP ${response.status}: ` +

      `${
        json?.message ||
        text.slice(0, 200)
      }`

    );

  }


  if (json.status === "error") {

    throw new Error(
      json.message ||
      "Twelve Data returned an error."
    );

  }


  if (!Array.isArray(json.values)) {

    throw new Error(
      "Twelve Data returned no historical candles."
    );

  }


  return json.values

    .map(row => ({

      time:
        parseTDTime(
          row.datetime
        ),

      open:
        Number(
          row.open
        ),

      high:
        Number(
          row.high
        ),

      low:
        Number(
          row.low
        ),

      close:
        Number(
          row.close
        ),

      volume:
        Number(
          row.volume
        ) || 0

    }))

    .filter(bar =>

      Number.isFinite(
        bar.time.getTime()
      )

      &&

      Number.isFinite(
        bar.open
      )

      &&

      Number.isFinite(
        bar.high
      )

      &&

      Number.isFinite(
        bar.low
      )

      &&

      Number.isFinite(
        bar.close
      )

    )

    .sort(
      (a, b) =>
        a.time - b.time
    );

}


/* ============================================================
   MASTER BACKTEST
============================================================ */

function runBacktest(
  bars,
  settings
) {

  const startIndex =
    Math.max(
      settings.minimumBars,
      300
    );


  const trades = [];

  const skipped = {

    lowRaid: 0,
    lowLiquidity: 0,
    lowQuality: 0,
    tooFar: 0,
    wrongSide: 0,
    dormant: 0,
    session: 0,
    cooldown: 0,
    positionLimit: 0,
    invalidTarget: 0

  };


  let balance =
    settings.startingBalance;


  let peakBalance =
    balance;


  let maxDrawdownPct =
    0;


  let lastEntryIndex =
    -999999;


  let openTrades =
    [];


  const equityCurve = [

    {
      time:
        bars[startIndex]
          .time
          .toISOString(),

      balance:
        round(
          balance,
          2
        )
    }

  ];


  for (
    let i = startIndex;
    i < bars.length - 1;
    i++
  ) {

    const current =
      bars[i];


    /* --------------------------------------------------------
       HANDLE EXISTING POSITIONS
    -------------------------------------------------------- */

    if (openTrades.length) {

      const stillOpen =
        [];


      for (
        const trade of openTrades
      ) {

        const resolution =
          evaluateTradeBar(

            trade,

            current,

            settings

          );


        if (resolution.closed) {

          finalizeTrade(

            trade,

            resolution,

            current,

            i,

            settings

          );


          trades.push(
            trade
          );


          balance +=
            trade.pnlCash;


          peakBalance =
            Math.max(
              peakBalance,
              balance
            );


          const dd =

            peakBalance > 0

              ?

              (
                peakBalance -
                balance
              )

              /
              peakBalance

              *
              100

              :

              0;


          maxDrawdownPct =
            Math.max(
              maxDrawdownPct,
              dd
            );


          equityCurve.push({

            time:
              current.time
                .toISOString(),

            balance:
              round(
                balance,
                2
              )

          });

        }

        else {

          stillOpen.push(
            trade
          );

        }

      }


      openTrades =
        stillOpen;

    }


    if (
      trades.length >=
      settings.maxTrades
    ) {

      break;

    }


    /* --------------------------------------------------------
       ONE POSITION AT A TIME
    -------------------------------------------------------- */

    if (

      settings.oneTradeAtATime

      &&

      openTrades.length >
      0

    ) {

      skipped.positionLimit++;
      continue;

    }


    /* --------------------------------------------------------
       COOLDOWN
    -------------------------------------------------------- */

    if (

      i -
      lastEntryIndex

      <=

      settings.cooldownBars

    ) {

      skipped.cooldown++;
      continue;

    }


    /* --------------------------------------------------------
       SESSION FILTER
    -------------------------------------------------------- */

    if (
      !sessionAllowed(
        current.time,
        settings.sessionFilter
      )
    ) {

      skipped.session++;
      continue;

    }


    /* --------------------------------------------------------
       BUILD HISTORICAL STATE

       IMPORTANT:
       history ends at candle i.
       Entry = candle i + 1 OPEN.
    -------------------------------------------------------- */

    const state =
      buildHistoricalState(
        bars,
        i
      );


    if (
      !state ||
      !state.pools.length
    ) {

      continue;

    }


    const qualifying =
      [];


    for (
      const pool of state.pools
    ) {

      if (
        pool.raidStrength <
        settings.minRaidScore
      ) {

        skipped.lowRaid++;
        continue;

      }


      if (
        pool.liquidityStrength <
        settings.minLiquidityStrength
      ) {

        skipped.lowLiquidity++;
        continue;

      }


      if (
        pool.combinedQuality <
        settings.minCombinedQuality
      ) {

        skipped.lowQuality++;
        continue;

      }


      if (
        pool.distanceAtr >
        settings.maxDistanceAtr
      ) {

        skipped.tooFar++;
        continue;

      }


      if (

        !settings.allowDormant

        &&

        pool.stage ===
        "DORMANT"

      ) {

        skipped.dormant++;
        continue;

      }


      const direction =

        pool.side === "HIGH"

          ? "BUY"

          : "SELL";


      if (

        settings.tradeSide !==
        "BOTH"

        &&

        settings.tradeSide !==
        direction

      ) {

        skipped.wrongSide++;
        continue;

      }


      qualifying.push(
        pool
      );

    }


    if (!qualifying.length) {

      continue;

    }


    /*
       "Trade every liquidity setup"

       If oneTradeAtATime = false, every qualifying pool can
       create a trade.

       If true, highest Raid Strength setup is selected.
    */

    const setups =
      settings.oneTradeAtATime

        ?

        [
          qualifying
            .sort(
              sortPools
            )[0]
        ]

        :

        qualifying
          .sort(
            sortPools
          );


    for (
      const setup of setups
    ) {

      if (
        trades.length +
        openTrades.length >=
        settings.maxTrades
      ) {

        break;

      }


      const next =
        bars[i + 1];


      const trade =
        createTrade({

          setup,

          entryBar:
            next,

          signalBar:
            current,

          signalIndex:
            i,

          entryIndex:
            i + 1,

          state,

          balance,

          settings

        });


      if (!trade) {

        skipped.invalidTarget++;
        continue;

      }


      openTrades.push(
        trade
      );


      lastEntryIndex =
        i + 1;


      if (
        settings.oneTradeAtATime
      ) {

        break;

      }

    }

  }


  /* ========================================================
     FORCE CLOSE REMAINING POSITIONS
  ======================================================== */

  const finalBar =
    bars.at(-1);


  for (
    const trade of openTrades
  ) {

    closeAtEnd(
      trade,
      finalBar,
      bars.length - 1,
      settings
    );


    trades.push(
      trade
    );


    balance +=
      trade.pnlCash;

  }


  /* ========================================================
     RESULTS
  ======================================================== */

  const summary =
    summarizeTrades({

      trades,

      settings,

      startingBalance:
        settings.startingBalance,

      endingBalance:
        balance,

      maxDrawdownPct

    });


  const raidBuckets =
    groupByRaidScore(
      trades
    );


  const typeStats =
    groupByLiquidityType(
      trades
    );


  const sideStats =
    groupBySide(
      trades
    );


  const sessionStats =
    groupBySession(
      trades
    );


  return {

    summary,

    skipped,

    raidBuckets,

    typeStats,

    sideStats,

    sessionStats,

    equityCurve,

    trades:
      trades
        .slice(-1000)
        .map(cleanTradeForOutput)

  };

}


/* ============================================================
   HISTORICAL STATE
============================================================ */

function buildHistoricalState(
  allBars,
  endIndex
) {

  const m5 =
    allBars.slice(
      Math.max(
        0,
        endIndex - 1200
      ),
      endIndex + 1
    );


  if (m5.length < 250) {

    return null;

  }


  const current =
    m5.at(-1);


  const price =
    current.close;


  const m15 =
    resample(
      m5,
      15
    );


  const h1 =
    resample(
      m5,
      60
    );


  const h4 =
    resample(
      m5,
      240
    );


  if (
    m15.length < 50 ||
    h1.length < 20
  ) {

    return null;

  }


  const atr5 =
    lastFinite(
      atrSeries(
        m5,
        14
      )
    ) || 1;


  const atr15 =
    lastFinite(
      atrSeries(
        m15,
        14
      )
    ) || atr5;


  const atrH1 =
    lastFinite(
      atrSeries(
        h1,
        14
      )
    ) || atr15;


  const structure = {

    m5:
      timeframeState(
        m5
      ),

    m15:
      timeframeState(
        m15
      ),

    h1:
      timeframeState(
        h1
      ),

    h4:
      timeframeState(
        h4
      )

  };


  const sessions =
    buildSessionLevels(
      m5,
      current.time
    );


  const reference =
    buildReferenceLevelsHistorical(
      h1,
      current.time
    );


  const equalLevels =
    detectEqualLiquidity(
      m15,
      atr15
    );


  const swings =
    pivots(
      h1,
      3,
      150
    );


  const flow =
    buildFlowEngine(
      m5
    );


  const regime =
    buildMarketRegime({

      structure,

      m5,

      atr5,

      flow

    });


  const profile =
    buildActivityProfile(
      m5.slice(-400),
      36
    );


  const rawPools =
    buildLiquidityPools({

      price,

      sessions,

      reference,

      equalLevels,

      h1Swings:
        swings,

      atrH1

    });


  const pools =
    rawPools

      .map(pool =>

        scoreHistoricalLiquidityPool({

          pool,

          price,

          atr5,

          atr15,

          structure,

          flow,

          regime,

          profile

        })

      )

      .filter(Boolean)

      .sort(
        sortPools
      )

      .slice(
        0,
        16
      );


  return {

    time:
      current.time,

    price,

    atr5,

    atr15,

    atrH1,

    structure,

    sessions,

    reference,

    equalLevels,

    flow,

    regime,

    profile,

    pools

  };

}


/* ============================================================
   SCORE POOL
============================================================ */

function scoreHistoricalLiquidityPool({

  pool,

  price,

  atr5,

  atr15,

  structure,

  flow,

  regime,

  profile

}) {

  const direction =

    pool.side === "HIGH"

      ? 1

      : -1;


  const distance =
    Math.abs(
      pool.level -
      price
    );


  const distanceAtr =

    distance /
    Math.max(
      atr15,
      0.000001
    );


  const correctSide =

    pool.side === "HIGH"

      ?

      pool.level >
      price

      :

      pool.level <
      price;


  if (!correctSide) {

    return null;

  }


  /* ========================================================
     LIQUIDITY STRENGTH
  ======================================================== */

  let liquidityStrength =

    30 +

    pool.importance *
    30;


  if (
    pool.type === "PDH" ||
    pool.type === "PDL"
  ) {

    liquidityStrength += 8;

  }


  if (
    pool.type === "PWH" ||
    pool.type === "PWL"
  ) {

    liquidityStrength += 12;

  }


  if (
    pool.type === "EQH" ||
    pool.type === "EQL"
  ) {

    liquidityStrength += 10;

  }


  if (pool.aliases.length) {

    liquidityStrength +=

      Math.min(
        12,
        pool.aliases.length * 4
      );

  }


  const profileNodes = [

    profile.poc,

    ...profile.hvn

  ].filter(
    Number.isFinite
  );


  if (
    profileNodes.some(

      node =>

        Math.abs(
          node -
          pool.level
        )

        <=

        atr5 *
        0.25

    )
  ) {

    liquidityStrength += 8;

  }


  liquidityStrength =
    clamp(
      liquidityStrength,
      0,
      100
    );


  /* ========================================================
     RAID SCORE

     V4 live score used:
     M1
     M5
     M15
     H1
     H4

     This historical backtest only downloads M5 with API 4,
     therefore weights are redistributed to:

     M5  = 25%
     M15 = 35%
     H1  = 25%
     H4  = 15%
  ======================================================== */

  const mtfPressure =

    structure.m5.score *
    0.25

    +

    structure.m15.score *
    0.35

    +

    structure.h1.score *
    0.25

    +

    structure.h4.score *
    0.15;


  const directionalTrend =
    direction *
    mtfPressure;


  const delta =
    flow.m15?.deltaPct || 0;


  let raidStrength =

    50 *
    Math.exp(
      -distanceAtr /
      1.25
    )

    +

    20;


  raidStrength +=

    clamp(
      directionalTrend / 6,
      -15,
      15
    );


  raidStrength +=

    clamp(
      direction *
      delta /
      2.8,
      -12,
      12
    );


  if (
    regime.volatility ===
    "EXPANDING"
  ) {

    raidStrength += 8;

  }


  raidStrength =
    clamp(
      raidStrength,
      0,
      100
    );


  /* ========================================================
     COMBINED QUALITY

     Historical match and FRED are deliberately excluded here
     so we do not accidentally inject current macro data into
     historical candles.
  ======================================================== */

  const quality =

    liquidityStrength *
    0.45

    +

    raidStrength *
    0.55;


  /* ========================================================
     APPROXIMATE SWEEP ZONE
  ======================================================== */

  let overshootAtr =
    0.20;


  if (
    raidStrength >= 80
  ) {

    overshootAtr =
      0.30;

  }


  if (
    raidStrength >= 90
  ) {

    overshootAtr =
      0.40;

  }


  if (
    regime.volatility ===
    "EXPANDING"
  ) {

    overshootAtr *=
      1.15;

  }


  const sweepTarget =

    pool.level

    +

    direction *
    atr5 *
    overshootAtr;


  const stage =

    distanceAtr <= 0.20

      ?

      "RAID IMMINENT"

      :

      distanceAtr <= 0.50

        ?

        "APPROACHING"

        :

        distanceAtr <= 1.25

          ?

          "TRACKING"

          :

          "DORMANT";


  return {

    ...pool,

    distance:
      round(
        distance,
        3
      ),

    distanceAtr:
      round(
        distanceAtr,
        3
      ),

    liquidityStrength:
      round(
        liquidityStrength,
        1
      ),

    raidStrength:
      round(
        raidStrength,
        1
      ),

    combinedQuality:
      round(
        quality,
        1
      ),

    mtfPressure:
      round(
        mtfPressure,
        1
      ),

    directionalTrend:
      round(
        directionalTrend,
        1
      ),

    delta:
      round(
        delta,
        1
      ),

    stage,

    projectedSweep: {

      target:
        round(
          sweepTarget,
          3
        ),

      overshootAtr:
        round(
          overshootAtr,
          3
        )

    }

  };

}


/* ============================================================
   CREATE TRADE
============================================================ */

function createTrade({

  setup,

  entryBar,

  signalBar,

  signalIndex,

  entryIndex,

  state,

  balance,

  settings

}) {

  const side =

    setup.side === "HIGH"

      ? "BUY"

      : "SELL";


  const direction =
    side === "BUY"
      ? 1
      : -1;


  const rawEntry =
    entryBar.open;


  const executionCost =

    settings.spread / 2

    +

    settings.slippage;


  const entry =

    rawEntry

    +

    direction *
    executionCost;


  const stopDistance =

    state.atr5 *
    settings.stopAtr;


  if (
    stopDistance <= 0
  ) {

    return null;

  }


  const stop =

    side === "BUY"

      ?

      entry -
      stopDistance

      :

      entry +
      stopDistance;


  let target;


  if (
    settings.targetMode ===
    "LIQUIDITY"
  ) {

    target =
      setup.level;

  }


  else if (
    settings.targetMode ===
    "SWEEP"
  ) {

    target =
      setup.projectedSweep.target;

  }


  else {

    target =

      side === "BUY"

        ?

        entry +
        stopDistance *
        settings.rr

        :

        entry -
        stopDistance *
        settings.rr;

  }


  /*
     Reject target that is behind entry.
  */

  if (

    side === "BUY"

    &&

    target <=
    entry

  ) {

    return null;

  }


  if (

    side === "SELL"

    &&

    target >=
    entry

  ) {

    return null;

  }


  const rewardDistance =
    Math.abs(
      target -
      entry
    );


  const effectiveRR =

    rewardDistance /
    stopDistance;


  const riskCash =

    balance *
    settings.riskPct /
    100;


  return {

    id:
      `${entryBar.time.getTime()}-${setup.type}-${setup.side}`,

    status:
      "OPEN",

    side,

    liquidity:
      setup.name,

    liquidityType:
      setup.type,

    liquidityLevel:
      round(
        setup.level,
        3
      ),

    signalTime:
      signalBar.time
        .toISOString(),

    entryTime:
      entryBar.time
        .toISOString(),

    exitTime:
      null,

    signalIndex,

    entryIndex,

    exitIndex:
      null,

    session:
      getTradingSession(
        entryBar.time
      ),

    entry:
      round(
        entry,
        3
      ),

    stop:
      round(
        stop,
        3
      ),

    target:
      round(
        target,
        3
      ),

    stopDistance:
      round(
        stopDistance,
        3
      ),

    rewardDistance:
      round(
        rewardDistance,
        3
      ),

    effectiveRR:
      round(
        effectiveRR,
        3
      ),

    riskCash:
      round(
        riskCash,
        2
      ),

    raidStrength:
      setup.raidStrength,

    liquidityStrength:
      setup.liquidityStrength,

    combinedQuality:
      setup.combinedQuality,

    distanceAtr:
      setup.distanceAtr,

    stage:
      setup.stage,

    regime:
      state.regime.label,

    mtf: {

      m5:
        state.structure.m5.bias,

      m15:
        state.structure.m15.bias,

      h1:
        state.structure.h1.bias,

      h4:
        state.structure.h4.bias

    },

    flowDelta:
      setup.delta,

    result:
      null,

    exit:
      null,

    pnlR:
      0,

    pnlCash:
      0,

    barsHeld:
      0

  };

}


/* ============================================================
   EVALUATE OPEN TRADE
============================================================ */

function evaluateTradeBar(
  trade,
  bar,
  settings
) {

  const buy =
    trade.side ===
    "BUY";


  const hitStop =

    buy

      ?

      bar.low <=
      trade.stop

      :

      bar.high >=
      trade.stop;


  const hitTarget =

    buy

      ?

      bar.high >=
      trade.target

      :

      bar.low <=
      trade.target;


  if (
    hitStop &&
    hitTarget
  ) {

    if (
      settings.collisionMode ===
      "TP_FIRST"
    ) {

      return {

        closed: true,
        result: "WIN",
        exit: trade.target

      };

    }


    return {

      closed: true,
      result: "LOSS",
      exit: trade.stop

    };

  }


  if (hitStop) {

    return {

      closed: true,
      result: "LOSS",
      exit: trade.stop

    };

  }


  if (hitTarget) {

    return {

      closed: true,
      result: "WIN",
      exit: trade.target

    };

  }


  return {

    closed: false

  };

}


/* ============================================================
   FINALIZE TRADE
============================================================ */

function finalizeTrade(
  trade,
  resolution,
  bar,
  exitIndex,
  settings
) {

  const direction =
    trade.side === "BUY"
      ? 1
      : -1;


  let exit =
    resolution.exit;


  /*
     Exit slippage.
  */

  exit -=

    direction *
    settings.slippage;


  const pnlDistance =

    direction *
    (
      exit -
      trade.entry
    );


  const pnlR =

    pnlDistance /
    Math.max(
      trade.stopDistance,
      0.000001
    );


  trade.status =
    "CLOSED";


  trade.result =
    resolution.result;


  trade.exit =
    round(
      exit,
      3
    );


  trade.exitTime =
    bar.time
      .toISOString();


  trade.exitIndex =
    exitIndex;


  trade.pnlR =
    round(
      pnlR,
      4
    );


  trade.pnlCash =
    round(

      trade.riskCash *
      pnlR,

      2

    );


  trade.barsHeld =

    exitIndex -
    trade.entryIndex +
    1;

}


/* ============================================================
   FORCE CLOSE
============================================================ */

function closeAtEnd(
  trade,
  bar,
  index,
  settings
) {

  const direction =
    trade.side === "BUY"
      ? 1
      : -1;


  const exit =

    bar.close

    -

    direction *
    settings.slippage;


  const pnlDistance =

    direction *
    (
      exit -
      trade.entry
    );


  const pnlR =

    pnlDistance /
    Math.max(
      trade.stopDistance,
      0.000001
    );


  trade.status =
    "CLOSED";


  trade.result =

    pnlR > 0

      ? "FORCED_WIN"

      : pnlR < 0

        ? "FORCED_LOSS"

        : "FLAT";


  trade.exit =
    round(
      exit,
      3
    );


  trade.exitTime =
    bar.time
      .toISOString();


  trade.exitIndex =
    index;


  trade.pnlR =
    round(
      pnlR,
      4
    );


  trade.pnlCash =
    round(

      trade.riskCash *
      pnlR,

      2

    );


  trade.barsHeld =

    index -
    trade.entryIndex +
    1;

}


/* ============================================================
   SUMMARY
============================================================ */

function summarizeTrades({

  trades,

  settings,

  startingBalance,

  endingBalance,

  maxDrawdownPct

}) {

  const wins =
    trades.filter(
      x =>
        x.pnlR > 0
    );


  const losses =
    trades.filter(
      x =>
        x.pnlR < 0
    );


  const flats =
    trades.filter(
      x =>
        x.pnlR === 0
    );


  const grossProfitR =
    sum(
      wins.map(
        x => x.pnlR
      )
    );


  const grossLossR =
    Math.abs(

      sum(
        losses.map(
          x => x.pnlR
        )
      )

    );


  const totalR =
    sum(
      trades.map(
        x => x.pnlR
      )
    );


  const avgR =

    trades.length

      ?

      totalR /
      trades.length

      :

      0;


  const winRate =

    trades.length

      ?

      wins.length /
      trades.length *
      100

      :

      0;


  const profitFactor =

    grossLossR > 0

      ?

      grossProfitR /
      grossLossR

      :

      grossProfitR > 0

        ? 999

        : 0;


  const avgRaid =

    trades.length

      ?

      mean(
        trades.map(
          x => x.raidStrength
        )
      )

      :

      0;


  const avgLiquidity =

    trades.length

      ?

      mean(
        trades.map(
          x => x.liquidityStrength
        )
      )

      :

      0;


  const avgQuality =

    trades.length

      ?

      mean(
        trades.map(
          x => x.combinedQuality
        )
      )

      :

      0;


  const avgBarsHeld =

    trades.length

      ?

      mean(
        trades.map(
          x => x.barsHeld
        )
      )

      :

      0;


  const returnPct =

    startingBalance > 0

      ?

      (
        endingBalance -
        startingBalance
      )

      /
      startingBalance

      *
      100

      :

      0;


  return {

    trades:
      trades.length,

    wins:
      wins.length,

    losses:
      losses.length,

    flats:
      flats.length,

    winRate:
      round(
        winRate,
        2
      ),

    profitFactor:
      round(
        profitFactor,
        2
      ),

    totalR:
      round(
        totalR,
        2
      ),

    expectancyR:
      round(
        avgR,
        3
      ),

    grossProfitR:
      round(
        grossProfitR,
        2
      ),

    grossLossR:
      round(
        grossLossR,
        2
      ),

    averageRaidScore:
      round(
        avgRaid,
        1
      ),

    averageLiquidityStrength:
      round(
        avgLiquidity,
        1
      ),

    averageCombinedQuality:
      round(
        avgQuality,
        1
      ),

    averageBarsHeld:
      round(
        avgBarsHeld,
        1
      ),

    startingBalance:
      round(
        startingBalance,
        2
      ),

    endingBalance:
      round(
        endingBalance,
        2
      ),

    netProfit:
      round(
        endingBalance -
        startingBalance,
        2
      ),

    returnPct:
      round(
        returnPct,
        2
      ),

    maxDrawdownPct:
      round(
        maxDrawdownPct,
        2
      ),

    settings: {

      raidThreshold:
        settings.minRaidScore,

      targetMode:
        settings.targetMode,

      rr:
        settings.rr,

      stopAtr:
        settings.stopAtr

    }

  };

}


/* ============================================================
   GROUP RAID SCORE
============================================================ */

function groupByRaidScore(trades) {

  const buckets = [

    {
      min: 0,
      max: 69.999,
      name: "<70"
    },

    {
      min: 70,
      max: 74.999,
      name: "70-74"
    },

    {
      min: 75,
      max: 79.999,
      name: "75-79"
    },

    {
      min: 80,
      max: 84.999,
      name: "80-84"
    },

    {
      min: 85,
      max: 89.999,
      name: "85-89"
    },

    {
      min: 90,
      max: 94.999,
      name: "90-94"
    },

    {
      min: 95,
      max: 100.001,
      name: "95-100"
    }

  ];


  return buckets.map(bucket => {

    const rows =
      trades.filter(

        trade =>

          trade.raidStrength >=
          bucket.min

          &&

          trade.raidStrength <=
          bucket.max

      );


    return createGroupStats(
      bucket.name,
      rows
    );

  });

}


/* ============================================================
   GROUP LIQUIDITY TYPE
============================================================ */

function groupByLiquidityType(trades) {

  const map =
    new Map();


  for (const trade of trades) {

    if (
      !map.has(
        trade.liquidityType
      )
    ) {

      map.set(
        trade.liquidityType,
        []
      );

    }


    map
      .get(
        trade.liquidityType
      )
      .push(
        trade
      );

  }


  return [...map.entries()]

    .map(
      ([name, rows]) =>
        createGroupStats(
          name,
          rows
        )
    )

    .sort(
      (a, b) =>
        b.trades - a.trades
    );

}


/* ============================================================
   GROUP SIDE
============================================================ */

function groupBySide(trades) {

  return [

    createGroupStats(

      "BUY",

      trades.filter(
        x =>
          x.side === "BUY"
      )

    ),

    createGroupStats(

      "SELL",

      trades.filter(
        x =>
          x.side === "SELL"
      )

    )

  ];

}


/* ============================================================
   GROUP SESSION
============================================================ */

function groupBySession(trades) {

  const sessions = [
    "ASIA",
    "LONDON",
    "NEW_YORK",
    "OTHER"
  ];


  return sessions.map(name =>

    createGroupStats(

      name,

      trades.filter(
        x =>
          x.session === name
      )

    )

  );

}


/* ============================================================
   GROUP STATS
============================================================ */

function createGroupStats(
  name,
  rows
) {

  const wins =
    rows.filter(
      x =>
        x.pnlR > 0
    );


  const losses =
    rows.filter(
      x =>
        x.pnlR < 0
    );


  const totalR =
    sum(
      rows.map(
        x => x.pnlR
      )
    );


  const grossProfit =
    sum(
      wins.map(
        x => x.pnlR
      )
    );


  const grossLoss =
    Math.abs(

      sum(
        losses.map(
          x => x.pnlR
        )
      )

    );


  return {

    name,

    trades:
      rows.length,

    wins:
      wins.length,

    losses:
      losses.length,

    winRate:

      rows.length

        ?

        round(
          wins.length /
          rows.length *
          100,
          1
        )

        :

        0,

    totalR:
      round(
        totalR,
        2
      ),

    expectancyR:

      rows.length

        ?

        round(
          totalR /
          rows.length,
          3
        )

        :

        0,

    profitFactor:

      grossLoss > 0

        ?

        round(
          grossProfit /
          grossLoss,
          2
        )

        :

        grossProfit > 0

          ? 999

          : 0

  };

}


/* ============================================================
   SESSION LEVELS
============================================================ */

function buildSessionLevels(
  bars,
  now
) {

  const sessions = [

    buildSingleSession(
      bars,
      now,
      "ASIA"
    ),

    buildSingleSession(
      bars,
      now,
      "LONDON"
    ),

    buildSingleSession(
      bars,
      now,
      "NEW_YORK"
    )

  ];


  return sessions.filter(Boolean);

}


function buildSingleSession(
  bars,
  now,
  name
) {

  const nowDate =
    now.toISOString()
      .slice(
        0,
        10
      );


  let selected = [];


  /*
     Approximate UTC session windows.

     Asia    00:00-09:00 UTC
     London  07:00-16:00 UTC
     NewYork 13:00-22:00 UTC

     We use these for historical reproducibility.
  */

  let startHour;
  let endHour;


  if (name === "ASIA") {

    startHour = 0;
    endHour = 9;

  }

  else if (name === "LONDON") {

    startHour = 7;
    endHour = 16;

  }

  else {

    startHour = 13;
    endHour = 22;

  }


  for (
    let dayOffset = 0;
    dayOffset <= 3;
    dayOffset++
  ) {

    const date =
      new Date(
        now.getTime() -
        dayOffset *
        86400000
      );


    const key =
      date.toISOString()
        .slice(
          0,
          10
        );


    selected =
      bars.filter(bar => {

        const barDate =
          bar.time
            .toISOString()
            .slice(
              0,
              10
            );


        const hour =
          bar.time
            .getUTCHours();


        return (

          barDate === key

          &&

          hour >=
          startHour

          &&

          hour <
          endHour

        );

      });


    if (selected.length >= 3) {

      break;

    }

  }


  if (!selected.length) {

    return null;

  }


  const high =
    Math.max(
      ...selected.map(
        x => x.high
      )
    );


  const low =
    Math.min(
      ...selected.map(
        x => x.low
      )
    );


  return {

    id:
      name.toLowerCase(),

    short:
      name,

    range: {

      high:
        round(
          high,
          3
        ),

      low:
        round(
          low,
          3
        )

    }

  };

}


/* ============================================================
   REFERENCE LEVELS HISTORICAL
============================================================ */

function buildReferenceLevelsHistorical(
  h1,
  now
) {

  const today =
    now.toISOString()
      .slice(
        0,
        10
      );


  const dayGroups =
    new Map();


  for (const bar of h1) {

    const key =
      bar.time
        .toISOString()
        .slice(
          0,
          10
        );


    if (key >= today) {

      continue;

    }


    if (!dayGroups.has(key)) {

      dayGroups.set(
        key,
        []
      );

    }


    dayGroups
      .get(key)
      .push(bar);

  }


  const completedDays =
    [...dayGroups.keys()]
      .sort();


  const previousDayKey =
    completedDays.at(-1);


  let previousDay =
    null;


  if (previousDayKey) {

    const rows =
      dayGroups.get(
        previousDayKey
      );


    previousDay = {

      date:
        previousDayKey,

      high:
        round(

          Math.max(
            ...rows.map(
              x => x.high
            )
          ),

          3

        ),

      low:
        round(

          Math.min(
            ...rows.map(
              x => x.low
            )
          ),

          3

        )

    };

  }


  const weekGroups =
    new Map();


  const currentWeek =
    weekKey(now);


  for (const bar of h1) {

    const key =
      weekKey(
        bar.time
      );


    if (key >= currentWeek) {

      continue;

    }


    if (!weekGroups.has(key)) {

      weekGroups.set(
        key,
        []
      );

    }


    weekGroups
      .get(key)
      .push(bar);

  }


  const completedWeeks =
    [...weekGroups.keys()]
      .sort();


  const previousWeekKey =
    completedWeeks.at(-1);


  let previousWeek =
    null;


  if (previousWeekKey) {

    const rows =
      weekGroups.get(
        previousWeekKey
      );


    previousWeek = {

      week:
        previousWeekKey,

      high:
        round(

          Math.max(
            ...rows.map(
              x => x.high
            )
          ),

          3

        ),

      low:
        round(

          Math.min(
            ...rows.map(
              x => x.low
            )
          ),

          3

        )

    };

  }


  return {

    previousDay,
    previousWeek

  };

}


/* ============================================================
   BUILD LIQUIDITY POOLS
============================================================ */

function buildLiquidityPools({

  price,

  sessions,

  reference,

  equalLevels,

  h1Swings,

  atrH1

}) {

  const pools = [];


  function add(
    name,
    level,
    side,
    type,
    importance
  ) {

    if (
      !Number.isFinite(
        Number(level)
      )
    ) {

      return;

    }


    pools.push({

      name,

      level:
        Number(level),

      side,

      type,

      importance,

      aliases: []

    });

  }


  for (const session of sessions) {

    if (!session?.range) {
      continue;
    }


    const importance =

      session.short === "ASIA"

        ? 1.40

        : 1.28;


    add(

      `${session.short} High`,

      session.range.high,

      "HIGH",

      `${session.short}_HIGH`,

      importance

    );


    add(

      `${session.short} Low`,

      session.range.low,

      "LOW",

      `${session.short}_LOW`,

      importance

    );

  }


  if (reference.previousDay) {

    add(

      "Previous Day High",

      reference.previousDay.high,

      "HIGH",

      "PDH",

      1.55

    );


    add(

      "Previous Day Low",

      reference.previousDay.low,

      "LOW",

      "PDL",

      1.55

    );

  }


  if (reference.previousWeek) {

    add(

      "Previous Week High",

      reference.previousWeek.high,

      "HIGH",

      "PWH",

      1.65

    );


    add(

      "Previous Week Low",

      reference.previousWeek.low,

      "LOW",

      "PWL",

      1.65

    );

  }


  for (
    const eq of
    equalLevels.highs
  ) {

    add(

      `Equal Highs ${eq.touches}x`,

      eq.price,

      "HIGH",

      "EQH",

      1.45

    );

  }


  for (
    const eq of
    equalLevels.lows
  ) {

    add(

      `Equal Lows ${eq.touches}x`,

      eq.price,

      "LOW",

      "EQL",

      1.45

    );

  }


  for (
    const swing of
    h1Swings.highs
      .slice(-4)
  ) {

    add(

      "H1 Swing High",

      swing.price,

      "HIGH",

      "H1_HIGH",

      1.10

    );

  }


  for (
    const swing of
    h1Swings.lows
      .slice(-4)
  ) {

    add(

      "H1 Swing Low",

      swing.price,

      "LOW",

      "H1_LOW",

      1.10

    );

  }


  const maxDistance =

    (
      atrH1 ||
      10
    )

    *
    7;


  const filtered =
    pools.filter(

      pool =>

        Math.abs(
          pool.level -
          price
        )

        <=

        maxDistance

    );


  return mergeNearbyPools(

    filtered,

    Math.max(

      (
        atrH1 ||
        1
      )

      *
      0.035,

      0.08

    )

  );

}


/* ============================================================
   MERGE POOLS
============================================================ */

function mergeNearbyPools(
  pools,
  tolerance
) {

  const result = [];


  const ordered =
    [...pools]
      .sort(
        (a, b) =>
          a.level - b.level
      );


  for (const pool of ordered) {

    const existing =
      result.find(

        item =>

          item.side ===
          pool.side

          &&

          Math.abs(
            item.level -
            pool.level
          )

          <=

          tolerance

      );


    if (!existing) {

      result.push({
        ...pool
      });

      continue;

    }


    const oldImportance =
      existing.importance;


    existing.aliases.push(
      pool.name
    );


    existing.level =

      (
        existing.level +
        pool.level
      )

      /
      2;


    if (
      pool.importance >
      oldImportance
    ) {

      existing.name =
        pool.name;

      existing.type =
        pool.type;

    }


    existing.importance =
      Math.max(
        oldImportance,
        pool.importance
      );

  }


  return result;

}


/* ============================================================
   EQUAL LIQUIDITY
============================================================ */

function detectEqualLiquidity(
  bars,
  atr
) {

  const swings =
    pivots(
      bars,
      2,
      240
    );


  const tolerance =
    Math.max(

      (
        atr ||
        1
      )

      *
      0.12,

      0.10

    );


  return {

    highs:
      clusterLiquidity(
        swings.highs,
        tolerance
      ),

    lows:
      clusterLiquidity(
        swings.lows,
        tolerance
      )

  };

}


function clusterLiquidity(
  swings,
  tolerance
) {

  const groups = [];


  for (const swing of swings) {

    const found =
      groups.find(

        group =>

          Math.abs(
            group.price -
            swing.price
          )

          <=

          tolerance

      );


    if (!found) {

      groups.push({

        price:
          swing.price,

        touches:
          1

      });

      continue;

    }


    found.price =

      (
        found.price *
        found.touches

        +

        swing.price
      )

      /

      (
        found.touches +
        1
      );


    found.touches++;

  }


  return groups

    .filter(
      x =>
        x.touches >= 2
    )

    .sort(
      (a, b) =>
        b.touches -
        a.touches
    )

    .slice(
      0,
      6
    )

    .map(
      x => ({

        price:
          round(
            x.price,
            3
          ),

        touches:
          x.touches

      })
    );

}


/* ============================================================
   MARKET REGIME
============================================================ */

function buildMarketRegime({

  structure,

  m5,

  atr5,

  flow

}) {

  const biasList = [

    structure.m5.bias,

    structure.m15.bias,

    structure.h1.bias,

    structure.h4.bias

  ];


  const bullish =
    biasList.filter(
      x =>
        x === "BULLISH"
    ).length;


  const bearish =
    biasList.filter(
      x =>
        x === "BEARISH"
    ).length;


  const trend =

    bullish >= 3

      ?

      "BULLISH"

      :

      bearish >= 3

        ?

        "BEARISH"

        :

        "MIXED";


  const atrHistory =
    atrSeries(
      m5,
      14
    );


  const baseline =
    median(
      atrHistory
    ) || atr5;


  const expansion =

    atr5 /
    Math.max(
      baseline,
      0.000001
    );


  const volatility =

    expansion >= 1.30

      ?

      "EXPANDING"

      :

      expansion <= 0.75

        ?

        "COMPRESSED"

        :

        "NORMAL";


  const delta =
    flow.m15?.deltaPct ||
    0;


  const orderFlow =

    delta >= 18

      ?

      "BUY DOMINANT"

      :

      delta <= -18

        ?

        "SELL DOMINANT"

        :

        "BALANCED";


  return {

    trend,

    volatility,

    orderFlow,

    atrExpansion:
      round(
        expansion,
        2
      ),

    label:
      `${trend} · ${volatility} · ${orderFlow}`

  };

}


/* ============================================================
   FLOW ENGINE
============================================================ */

function buildFlowEngine(bars) {

  const recent =
    bars.slice(-240);


  const ranges =
    recent.map(

      bar =>
        Math.max(
          bar.high -
          bar.low,
          0.000001
        )

    );


  const medianRange =
    median(ranges) || 1;


  const hasVolume =

    recent.filter(
      bar =>
        bar.volume > 0
    ).length

    >=

    recent.length *
    0.5;


  const rows =
    recent.map(bar => {

      const range =
        Math.max(
          bar.high -
          bar.low,
          0.000001
        );


      const body =

        (
          bar.close -
          bar.open
        )

        /
        range;


      const closeLocation =

        (
          (
            bar.close -
            bar.low
          )

          -

          (
            bar.high -
            bar.close
          )
        )

        /
        range;


      const activity =

        hasVolume

          ?

          Math.max(
            bar.volume,
            1
          )

          :

          clamp(

            range /
            medianRange,

            0.25,

            5

          )

          *
          100;


      const buyShare =
        clamp(

          0.5

          +

          closeLocation *
          0.30

          +

          body *
          0.20,

          0.05,

          0.95

        );


      const buy =
        activity *
        buyShare;


      const sell =
        activity -
        buy;


      return {

        activity,

        buy,

        sell,

        delta:
          buy -
          sell

      };

    });


  return {

    mode:

      hasVolume

        ?

        "OHLCV directional-volume proxy"

        :

        "Price-activity proxy",

    m5:
      aggregateFlow(
        rows.slice(-1)
      ),

    m15:
      aggregateFlow(
        rows.slice(-3)
      ),

    m30:
      aggregateFlow(
        rows.slice(-6)
      ),

    h1:
      aggregateFlow(
        rows.slice(-12)
      )

  };

}


function aggregateFlow(rows) {

  const activity =
    sum(
      rows.map(
        x => x.activity
      )
    );


  const delta =
    sum(
      rows.map(
        x => x.delta
      )
    );


  return {

    activity:
      round(
        activity,
        2
      ),

    delta:
      round(
        delta,
        2
      ),

    deltaPct:

      activity

        ?

        round(
          delta /
          activity *
          100,
          1
        )

        :

        0

  };

}


/* ============================================================
   ACTIVITY PROFILE
============================================================ */

function buildActivityProfile(
  bars,
  bins = 36
) {

  const low =
    Math.min(
      ...bars.map(
        x => x.low
      )
    );


  const high =
    Math.max(
      ...bars.map(
        x => x.high
      )
    );


  const step =

    (
      high -
      low
    )

    /
    bins

    ||

    1;


  const data =
    Array.from(

      {
        length: bins
      },

      (_, index) => ({

        price:

          low

          +

          (
            index +
            0.5
          )

          *
          step,

        activity: 0

      })

    );


  for (const bar of bars) {

    const typical =

      (
        bar.high +
        bar.low +
        bar.close
      )

      /
      3;


    const index =
      clamp(

        Math.floor(

          (
            typical -
            low
          )

          /
          step

        ),

        0,

        bins - 1

      );


    data[index].activity +=

      bar.volume > 0

        ? bar.volume

        : 1;

  }


  const highNodes =
    [...data]
      .sort(
        (a, b) =>
          b.activity -
          a.activity
      );


  return {

    poc:
      round(
        highNodes[0]
          ?.price,
        3
      ),

    hvn:
      highNodes
        .slice(0, 3)
        .map(
          x =>
            round(
              x.price,
              3
            )
        )

  };

}


/* ============================================================
   TIMEFRAME STATE
============================================================ */

function timeframeState(bars) {

  if (!bars.length) {

    return {

      bias: "NEUTRAL",
      score: 0

    };

  }


  const closes =
    bars.map(
      x => x.close
    );


  const e20 =
    emaSeries(
      closes,
      Math.min(
        20,
        closes.length
      )
    );


  const e50 =
    emaSeries(
      closes,
      Math.min(
        50,
        closes.length
      )
    );


  const e200 =
    emaSeries(
      closes,
      Math.min(
        200,
        closes.length
      )
    );


  const rsi =
    rsiValue(
      closes,
      Math.min(
        14,
        Math.max(
          2,
          closes.length - 1
        )
      )
    );


  const structure =
    marketStructure(
      bars
    );


  let score = 0;


  score +=

    closes.at(-1) >
    lastFinite(e20)

      ? 15

      : -15;


  score +=

    lastFinite(e20) >
    lastFinite(e50)

      ? 20

      : -20;


  score +=

    lastFinite(e50) >
    lastFinite(e200)

      ? 20

      : -20;


  if (rsi > 55) {
    score += 12;
  }


  if (rsi < 45) {
    score -= 12;
  }


  if (
    structure.bias ===
    "BULLISH"
  ) {

    score += 25;

  }


  if (
    structure.bias ===
    "BEARISH"
  ) {

    score -= 25;

  }


  score =
    clamp(
      score,
      -100,
      100
    );


  return {

    bias:

      score >= 25

        ?

        "BULLISH"

        :

        score <= -25

          ?

          "BEARISH"

          :

          "NEUTRAL",

    score:
      round(
        score,
        1
      ),

    rsi:
      round(
        rsi,
        1
      ),

    structure

  };

}


/* ============================================================
   STRUCTURE
============================================================ */

function marketStructure(bars) {

  const swings =
    pivots(
      bars,
      3,
      200
    );


  const h1 =
    swings.highs.at(-1);

  const h2 =
    swings.highs.at(-2);

  const l1 =
    swings.lows.at(-1);

  const l2 =
    swings.lows.at(-2);


  let bias =
    "NEUTRAL";


  if (
    h1 &&
    h2 &&
    l1 &&
    l2
  ) {

    if (

      h1.price >
      h2.price

      &&

      l1.price >
      l2.price

    ) {

      bias =
        "BULLISH";

    }

    else if (

      h1.price <
      h2.price

      &&

      l1.price <
      l2.price

    ) {

      bias =
        "BEARISH";

    }

  }


  return {

    bias,

    swingHigh:
      h1?.price ?? null,

    swingLow:
      l1?.price ?? null

  };

}


/* ============================================================
   PIVOTS
============================================================ */

function pivots(
  bars,
  radius = 3,
  lookback = 200
) {

  const highs = [];
  const lows = [];


  const start =
    Math.max(
      radius,
      bars.length -
      lookback
    );


  for (
    let i = start;
    i < bars.length - radius;
    i++
  ) {

    let highPivot = true;
    let lowPivot = true;


    for (
      let j = 1;
      j <= radius;
      j++
    ) {

      if (

        bars[i].high <=
        bars[i - j].high

        ||

        bars[i].high <
        bars[i + j].high

      ) {

        highPivot =
          false;

      }


      if (

        bars[i].low >=
        bars[i - j].low

        ||

        bars[i].low >
        bars[i + j].low

      ) {

        lowPivot =
          false;

      }

    }


    if (highPivot) {

      highs.push({

        price:
          bars[i].high,

        time:
          bars[i].time

      });

    }


    if (lowPivot) {

      lows.push({

        price:
          bars[i].low,

        time:
          bars[i].time

      });

    }

  }


  return {
    highs,
    lows
  };

}


/* ============================================================
   RESAMPLE
============================================================ */

function resample(
  bars,
  minutes
) {

  const period =
    minutes *
    60_000;


  const map =
    new Map();


  for (const bar of bars) {

    const bucket =

      Math.floor(

        bar.time.getTime() /
        period

      )

      *
      period;


    if (!map.has(bucket)) {

      map.set(
        bucket,
        {

          time:
            new Date(bucket),

          open:
            bar.open,

          high:
            bar.high,

          low:
            bar.low,

          close:
            bar.close,

          volume:
            bar.volume

        }
      );

    }

    else {

      const current =
        map.get(bucket);


      current.high =
        Math.max(
          current.high,
          bar.high
        );


      current.low =
        Math.min(
          current.low,
          bar.low
        );


      current.close =
        bar.close;


      current.volume +=
        bar.volume;

    }

  }


  return [...map.values()]
    .sort(
      (a, b) =>
        a.time - b.time
    );

}


/* ============================================================
   ATR
============================================================ */

function atrSeries(
  bars,
  period = 14
) {

  const tr = [];


  for (
    let i = 0;
    i < bars.length;
    i++
  ) {

    if (i === 0) {

      tr.push(
        bars[i].high -
        bars[i].low
      );

      continue;

    }


    tr.push(

      Math.max(

        bars[i].high -
        bars[i].low,

        Math.abs(
          bars[i].high -
          bars[i - 1].close
        ),

        Math.abs(
          bars[i].low -
          bars[i - 1].close
        )

      )

    );

  }


  return emaSeries(
    tr,
    period
  );

}


/* ============================================================
   EMA
============================================================ */

function emaSeries(
  values,
  period
) {

  if (!values.length) {
    return [];
  }


  const p =
    Math.max(
      1,
      period
    );


  const alpha =
    2 /
    (
      p +
      1
    );


  const out = [
    values[0]
  ];


  for (
    let i = 1;
    i < values.length;
    i++
  ) {

    out.push(

      values[i] *
      alpha

      +

      out[i - 1] *
      (
        1 -
        alpha
      )

    );

  }


  return out;

}


/* ============================================================
   RSI
============================================================ */

function rsiValue(
  values,
  period = 14
) {

  if (
    values.length <=
    period
  ) {

    return 50;

  }


  let gain = 0;
  let loss = 0;


  for (
    let i = 1;
    i <= period;
    i++
  ) {

    const change =
      values[i] -
      values[i - 1];


    gain +=
      Math.max(
        change,
        0
      );


    loss +=
      Math.max(
        -change,
        0
      );

  }


  let avgGain =
    gain /
    period;


  let avgLoss =
    loss /
    period;


  for (
    let i = period + 1;
    i < values.length;
    i++
  ) {

    const change =
      values[i] -
      values[i - 1];


    avgGain =

      (
        avgGain *
        (
          period -
          1
        )

        +

        Math.max(
          change,
          0
        )
      )

      /
      period;


    avgLoss =

      (
        avgLoss *
        (
          period -
          1
        )

        +

        Math.max(
          -change,
          0
        )
      )

      /
      period;

  }


  if (avgLoss === 0) {

    return 100;

  }


  const rs =
    avgGain /
    avgLoss;


  return (

    100

    -

    100 /
    (
      1 +
      rs
    )

  );

}


/* ============================================================
   SESSION FILTER
============================================================ */

function sessionAllowed(
  date,
  filter
) {

  if (filter === "ALL") {
    return true;
  }


  const session =
    getTradingSession(
      date
    );


  if (filter === "LONDON_NY") {

    return (
      session === "LONDON" ||
      session === "NEW_YORK"
    );

  }


  return session === filter;

}


function getTradingSession(date) {

  const hour =
    date.getUTCHours();


  if (
    hour >= 0 &&
    hour < 7
  ) {

    return "ASIA";

  }


  if (
    hour >= 7 &&
    hour < 13
  ) {

    return "LONDON";

  }


  if (
    hour >= 13 &&
    hour < 22
  ) {

    return "NEW_YORK";

  }


  return "OTHER";

}


/* ============================================================
   OUTPUT CLEANER
============================================================ */

function cleanTradeForOutput(trade) {

  return {

    id:
      trade.id,

    side:
      trade.side,

    liquidity:
      trade.liquidity,

    liquidityType:
      trade.liquidityType,

    liquidityLevel:
      trade.liquidityLevel,

    signalTime:
      trade.signalTime,

    entryTime:
      trade.entryTime,

    exitTime:
      trade.exitTime,

    session:
      trade.session,

    entry:
      trade.entry,

    stop:
      trade.stop,

    target:
      trade.target,

    exit:
      trade.exit,

    effectiveRR:
      trade.effectiveRR,

    raidStrength:
      trade.raidStrength,

    liquidityStrength:
      trade.liquidityStrength,

    combinedQuality:
      trade.combinedQuality,

    distanceAtr:
      trade.distanceAtr,

    stage:
      trade.stage,

    regime:
      trade.regime,

    mtf:
      trade.mtf,

    flowDelta:
      trade.flowDelta,

    result:
      trade.result,

    pnlR:
      trade.pnlR,

    pnlCash:
      trade.pnlCash,

    barsHeld:
      trade.barsHeld

  };

}


/* ============================================================
   SORT POOLS
============================================================ */

function sortPools(a, b) {

  if (
    b.raidStrength !==
    a.raidStrength
  ) {

    return (
      b.raidStrength -
      a.raidStrength
    );

  }


  return (
    b.combinedQuality -
    a.combinedQuality
  );

}


/* ============================================================
   WEEK KEY
============================================================ */

function weekKey(date) {

  const copy =
    new Date(

      Date.UTC(

        date.getUTCFullYear(),

        date.getUTCMonth(),

        date.getUTCDate()

      )

    );


  const day =
    copy.getUTCDay() ||
    7;


  copy.setUTCDate(

    copy.getUTCDate()

    +
    4

    -
    day

  );


  const yearStart =
    new Date(

      Date.UTC(

        copy.getUTCFullYear(),

        0,

        1

      )

    );


  const week =
    Math.ceil(

      (
        (
          copy -
          yearStart
        )

        /
        86400000

        +
        1
      )

      /
      7

    );


  return (

    `${copy.getUTCFullYear()}-W` +

    `${String(week).padStart(
      2,
      "0"
    )}`

  );

}


/* ============================================================
   TIME
============================================================ */

function parseTDTime(value) {

  if (!value) {

    return new Date(NaN);

  }


  if (
    value.includes("T")
  ) {

    return new Date(

      value.endsWith("Z")

        ? value

        : `${value}Z`

    );

  }


  return new Date(

    `${value.replace(
      " ",
      "T"
    )}Z`

  );

}


/* ============================================================
   SETTINGS HELPERS
============================================================ */

function numberSetting(
  value,
  fallback,
  min,
  max
) {

  const number =
    Number(value);


  if (!Number.isFinite(number)) {

    return fallback;

  }


  return clamp(
    number,
    min,
    max
  );

}


function intSetting(
  value,
  fallback,
  min,
  max
) {

  return Math.round(

    numberSetting(
      value,
      fallback,
      min,
      max
    )

  );

}


function boolSetting(
  value,
  fallback
) {

  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {

    return fallback;

  }


  const text =
    String(value)
      .toLowerCase();


  return (

    text === "true" ||
    text === "1" ||
    text === "yes" ||
    text === "on"

  );

}


function enumSetting(
  value,
  choices,
  fallback
) {

  const text =
    String(
      value ||
      fallback
    )
      .toUpperCase();


  return choices.includes(text)
    ? text
    : fallback;

}


/* ============================================================
   HELPERS
============================================================ */

function sum(values) {

  return values.reduce(

    (total, value) =>

      total

      +

      (
        Number.isFinite(
          Number(value)
        )

          ?

          Number(value)

          :

          0
      ),

    0

  );

}


function mean(values) {

  const clean =
    values.filter(
      x =>
        Number.isFinite(
          Number(x)
        )
    );


  return clean.length

    ?

    sum(clean) /
    clean.length

    :

    0;

}


function percentile(
  values,
  q
) {

  const sorted =
    values
      .filter(
        Number.isFinite
      )
      .slice()
      .sort(
        (a, b) =>
          a - b
      );


  if (!sorted.length) {

    return null;

  }


  const position =

    (
      sorted.length -
      1
    )

    *
    q;


  const low =
    Math.floor(
      position
    );


  const high =
    Math.ceil(
      position
    );


  if (low === high) {

    return sorted[low];

  }


  const weight =
    position -
    low;


  return (

    sorted[low] *
    (
      1 -
      weight
    )

    +

    sorted[high] *
    weight

  );

}


function median(values) {

  return percentile(
    values,
    0.5
  );

}


function lastFinite(values) {

  for (
    let i = values.length - 1;
    i >= 0;
    i--
  ) {

    if (
      Number.isFinite(
        Number(values[i])
      )
    ) {

      return Number(
        values[i]
      );

    }

  }


  return null;

}


function clamp(
  value,
  minimum,
  maximum
) {

  return Math.max(

    minimum,

    Math.min(
      maximum,
      value
    )

  );

}


function round(
  value,
  decimals = 2
) {

  if (
    !Number.isFinite(
      Number(value)
    )
  ) {

    return null;

  }


  const multiplier =
    10 **
    decimals;


  return (

    Math.round(

      Number(value) *
      multiplier

    )

    /
    multiplier

  );

}