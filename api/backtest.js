/* =========================================================
   MKAYFX XAU LIQUIDITY SWEEP BACKTEST ENGINE
   /api/backtest.js

   BACKTEST MODEL
   --------------
   XAU/USD
   Execution: M5
   Context:   M15 + H1

   LIQUIDITY SOURCES
   -----------------
   - Confirmed M5 pivot highs / lows
   - Previous Day High / Low
   - Asia High / Low

   SETUP
   -----
   1. Price approaches historical liquidity.
   2. Price sweeps through the level.
   3. Candle closes back through the level.
   4. Follow-through candle confirms rejection.
   5. M5 / M15 structure + delta proxy score setup.
   6. Entry occurs on NEXT candle open.

   EXIT MODEL
   ----------
   - SL behind sweep extreme
   - TP1 partial exit
   - TP2 final exit
   - After TP1, remainder moves to breakeven
   - Optional max holding time

   IMPORTANT
   ---------
   No future candles are used to generate an entry.
   Pivot levels only become available after confirmation.

   REQUIRED ENVIRONMENT VARIABLE
   -----------------------------
   TWELVE_DATA_API_KEY

   OPTIONAL ENVIRONMENT VARIABLES
   ------------------------------
   BACKTEST_SYMBOL
   BACKTEST_DAYS
   BACKTEST_INITIAL_BALANCE
   BACKTEST_RISK_PERCENT
   BACKTEST_MIN_SCORE
   BACKTEST_TP1_R
   BACKTEST_TP2_R
   BACKTEST_SPREAD
   BACKTEST_SLIPPAGE
   BACKTEST_MAX_TRADES
========================================================= */


const TD_KEY =
  process.env.TWELVE_DATA_API_KEY;


const TD_BASE =
  "https://api.twelvedata.com";


const DEFAULT_SYMBOL =
  process.env.BACKTEST_SYMBOL
  ||
  "XAU/USD";


/* =========================================================
   CONSTANTS
========================================================= */

const INTERVAL =
  "5min";


const BAR_MS =
  5 *
  60_000;


const PIVOT_LEFT =
  3;


const PIVOT_RIGHT =
  3;


const LEVEL_MAX_AGE =
  600;


const MAX_DAYS =
  90;


/* =========================================================
   HANDLER
========================================================= */

export default async function handler(
  req,
  res
) {

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


  if (
    req.method ===
    "OPTIONS"
  ) {

    return res
      .status(204)
      .end();

  }


  if (
    req.method !==
    "GET"
  ) {

    return res
      .status(405)
      .json({

        ok:
          false,

        error:
          "GET only"

      });

  }


  if (
    !TD_KEY
  ) {

    return res
      .status(500)
      .json({

        ok:
          false,

        error:
          "Missing TWELVE_DATA_API_KEY environment variable."

      });

  }


  const started =
    Date.now();


  try {

    /* =====================================================
       CONFIG
    ===================================================== */

    const config =
      readConfig(
        req
      );


    /* =====================================================
       HISTORICAL DATA
    ===================================================== */

    const end =
      new Date();


    const start =
      new Date(

        end.getTime()

        -

        config.days *
        24 *
        60 *
        60_000

      );


    const bars =
      await fetchHistoricalBars({

        symbol:
          config.symbol,

        start,

        end

      });


    if (
      bars.length <
      300
    ) {

      throw new Error(

        `Not enough historical candles. Received ${bars.length}.`

      );

    }


    /* =====================================================
       REMOVE INCOMPLETE CURRENT CANDLE
    ===================================================== */

    const completedBars =
      bars.filter(

        bar =>
          bar.ts +
          BAR_MS <=
          Date.now()

      );


    if (
      completedBars.length <
      300
    ) {

      throw new Error(
        "Not enough completed M5 candles."
      );

    }


    /* =====================================================
       RUN BACKTEST
    ===================================================== */

    const result =
      runBacktest(

        completedBars,

        config

      );


    /* =====================================================
       RESPONSE
    ===================================================== */

    return res
      .status(200)
      .json({

        ok:
          true,

        symbol:
          config.symbol,

        interval:
          INTERVAL,

        generatedAt:
          new Date()
            .toISOString(),

        runtimeMs:
          Date.now() -
          started,

        data: {

          bars:
            completedBars.length,

          from:
            new Date(
              completedBars[0].ts
            )
              .toISOString(),

          to:
            new Date(
              completedBars[
                completedBars.length - 1
              ].ts
            )
              .toISOString()

        },

        config,

        ...result

      });


  } catch (
    error
  ) {

    console.error(
      "Backtest error:",
      error
    );


    return res
      .status(500)
      .json({

        ok:
          false,

        error:
          error?.message
          ||
          "Unknown backtest error"

      });

  }

}


/* =========================================================
   CONFIG
========================================================= */

function readConfig(
  req
) {

  const q =
    req.query
    ||
    {};


  const symbol =
    String(
      q.symbol
      ||
      DEFAULT_SYMBOL
    );


  /*
    This project intentionally supports XAU/USD only.
  */
  if (
    symbol !==
    "XAU/USD"
  ) {

    throw new Error(
      "This backtester currently supports XAU/USD only."
    );

  }


  return {

    symbol,


    days:
      queryNumber(

        q.days,

        envNumber(
          "BACKTEST_DAYS",
          30
        ),

        5,

        MAX_DAYS

      ),


    initialBalance:
      queryNumber(

        q.balance,

        envNumber(
          "BACKTEST_INITIAL_BALANCE",
          200
        ),

        10,

        1_000_000

      ),


    riskPercent:
      queryNumber(

        q.risk,

        envNumber(
          "BACKTEST_RISK_PERCENT",
          1
        ),

        0.1,

        20

      ),


    minScore:
      queryNumber(

        q.minScore,

        envNumber(
          "BACKTEST_MIN_SCORE",
          70
        ),

        30,

        100

      ),


    tp1R:
      queryNumber(

        q.tp1R,

        envNumber(
          "BACKTEST_TP1_R",
          1.5
        ),

        0.5,

        10

      ),


    tp2R:
      queryNumber(

        q.tp2R,

        envNumber(
          "BACKTEST_TP2_R",
          2.5
        ),

        0.75,

        15

      ),


    spread:
      queryNumber(

        q.spread,

        envNumber(
          "BACKTEST_SPREAD",
          0
        ),

        0,

        20

      ),


    slippage:
      queryNumber(

        q.slippage,

        envNumber(
          "BACKTEST_SLIPPAGE",
          0
        ),

        0,

        20

      ),


    maxTrades:
      Math.round(

        queryNumber(

          q.maxTrades,

          envNumber(
            "BACKTEST_MAX_TRADES",
            1000
          ),

          1,

          5000

        )

      ),


    maxHoldBars:
      Math.round(

        queryNumber(

          q.maxHoldBars,

          72,

          6,

          500

        )

      )

  };

}


/* =========================================================
   TWELVE DATA HISTORY
========================================================= */

async function fetchHistoricalBars({

  symbol,

  start,

  end

}) {

  /*
    Twelve Data limits how much data a single
    time_series request can return.

    Fetch smaller time chunks and merge them.
  */

  const chunkDays =
    12;


  const all =
    [];


  let cursor =
    new Date(
      start
    );


  while (
    cursor <
    end
  ) {

    const chunkEnd =
      new Date(

        Math.min(

          end.getTime(),

          cursor.getTime()

          +

          chunkDays *
          24 *
          60 *
          60_000

        )

      );


    const rows =
      await fetchChunk({

        symbol,

        start:
          cursor,

        end:
          chunkEnd

      });


    all.push(
      ...rows
    );


    cursor =
      new Date(

        chunkEnd.getTime()

        +

        1000

      );

  }


  /* =====================================================
     DEDUPLICATE
  ===================================================== */

  const map =
    new Map();


  for (
    const bar of all
  ) {

    map.set(
      bar.ts,
      bar
    );

  }


  return Array
    .from(
      map.values()
    )
    .sort(
      (
        a,
        b
      ) =>
        a.ts -
        b.ts
    );

}


async function fetchChunk({

  symbol,

  start,

  end

}) {

  const url =
    new URL(
      `${TD_BASE}/time_series`
    );


  url.searchParams.set(
    "symbol",
    symbol
  );


  url.searchParams.set(
    "interval",
    INTERVAL
  );


  url.searchParams.set(
    "start_date",
    tdDate(
      start
    )
  );


  url.searchParams.set(
    "end_date",
    tdDate(
      end
    )
  );


  url.searchParams.set(
    "outputsize",
    "5000"
  );


  url.searchParams.set(
    "timezone",
    "UTC"
  );


  url.searchParams.set(
    "format",
    "JSON"
  );


  url.searchParams.set(
    "apikey",
    TD_KEY
  );


  const response =
    await fetch(
      url,
      {

        headers: {

          "User-Agent":
            "MKAYFX-XAU-Backtester/1.0"

        }

      }
    );


  if (
    !response.ok
  ) {

    throw new Error(

      `Twelve Data HTTP ${response.status}`

    );

  }


  const json =
    await response.json();


  if (
    json.status ===
    "error"
  ) {

    throw new Error(

      `Twelve Data: ` +

      (
        json.message
        ||
        json.code
        ||
        "unknown API error"
      )

    );

  }


  if (
    !Array.isArray(
      json.values
    )
  ) {

    return [];

  }


  return json.values

    .map(
      row => {

        const ts =
          Date.parse(

            String(
              row.datetime
            )
              .replace(
                " ",
                "T"
              )

            +

            "Z"

          );


        return {

          ts,

          open:
            num(
              row.open
            ),

          high:
            num(
              row.high
            ),

          low:
            num(
              row.low
            ),

          close:
            num(
              row.close
            ),

          volume:
            num(
              row.volume
            )

        };

      }
    )

    .filter(
      bar =>

        Number.isFinite(
          bar.ts
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

    );

}


/* =========================================================
   BACKTEST ENGINE
========================================================= */

function runBacktest(
  bars,
  config
) {

  /* =====================================================
     INDICATORS
  ===================================================== */

  const atr5 =
    atr(
      bars,
      14
    );


  const m5States =
    buildStateSeries(
      bars
    );


  const m15 =
    resample(
      bars,
      15
    );


  const h1 =
    resample(
      bars,
      60
    );


  const m15States =
    buildStateSeries(
      m15
    );


  const h1States =
    buildStateSeries(
      h1
    );


  const delta =
    buildDeltaSeries(
      bars
    );


  const delta3 =
    rollingAverage(
      delta,
      3
    );


  const delta9 =
    rollingAverage(
      delta,
      9
    );


  const contexts =
    buildDailyContext(
      bars
    );


  /* =====================================================
     STATE
  ===================================================== */

  const pivotHighs =
    [];


  const pivotLows =
    [];


  const usedStaticLevels =
    new Set();


  const trades =
    [];


  let pending =
    null;


  let blockedUntil =
    -1;


  let rejectedSignals =
    0;


  let balance =
    config.initialBalance;


  const equityCurve = [

    {

      trade:
        0,

      balance:
        round(
          balance,
          2
        )

    }

  ];


  /* =====================================================
     WALK FORWARD BAR-BY-BAR
  ===================================================== */

  for (

    let i =
      220;

    i <
    bars.length -
    2;

    i++

  ) {

    const bar =
      bars[i];


    const previous =
      bars[
        i - 1
      ];


    const atrValue =

      atr5[i]

      ||

      atr5[
        i - 1
      ]

      ||

      bar.close *
      0.001;


    /* ===================================================
       REMOVE OLD PIVOTS
    =================================================== */

    pruneLevels(
      pivotHighs,
      i
    );


    pruneLevels(
      pivotLows,
      i
    );


    /* ===================================================
       PROCESS SETUPS ONLY IF NO POSITION WOULD BE OPEN
    =================================================== */

    if (
      i >
      blockedUntil
    ) {

      /* =================================================
         PENDING SWEEP CONFIRMATION
      ================================================= */

      if (
        pending
      ) {

        const barsAfterSweep =
          i -
          pending.sweepIndex;


        if (
          barsAfterSweep >= 1

          &&

          barsAfterSweep <= 2
        ) {

          const confirmation =
            confirmSweep({

              pending,

              bar,

              atrValue

            });


          if (
            confirmation
          ) {

            const quality =
              calculateQuality({

                pending,

                confirmationBar:
                  bar,

                confirmationIndex:
                  i,

                atrValue,

                bars,

                m5States,

                m15,

                m15States,

                h1,

                h1States,

                delta3,

                delta9

              });


            if (
              quality.score >=
              config.minScore

              &&

              i + 1 <
              bars.length

              &&

              trades.length <
              config.maxTrades
            ) {

              const entryIndex =
                i + 1;


              const riskAmount =

                balance

                *

                (
                  config.riskPercent /
                  100
                );


              const trade =
                simulateTrade({

                  bars,

                  entryIndex,

                  pending,

                  quality,

                  config,

                  atrValue,

                  riskAmount,

                  startingBalance:
                    balance

                });


              trades.push(
                trade
              );


              balance =
                trade.endingBalance;


              equityCurve.push({

                trade:
                  trades.length,

                balance:
                  round(
                    balance,
                    2
                  )

              });


              blockedUntil =
                trade.exitIndex;


              pending =
                null;

            }

            else {

              rejectedSignals++;


              pending =
                null;

            }

          }

          else if (
            barsAfterSweep >= 2
          ) {

            rejectedSignals++;


            pending =
              null;

          }

        }

      }


      /* =================================================
         LOOK FOR A NEW SWEEP
      ================================================= */

      if (
        !pending

        &&

        i >
        blockedUntil

        &&

        trades.length <
        config.maxTrades
      ) {

        const staticLevels =
          getStaticLevels({

            bar,

            previous,

            context:
              contexts,

            index:
              i,

            used:
              usedStaticLevels

          });


        const highLevels = [

          ...pivotHighs
            .filter(
              x =>
                !x.used
            ),

          ...staticLevels
            .filter(
              x =>
                x.side ===
                "HIGH"
            )

        ];


        const lowLevels = [

          ...pivotLows
            .filter(
              x =>
                !x.used
            ),

          ...staticLevels
            .filter(
              x =>
                x.side ===
                "LOW"
            )

        ];


        const sweep =
          detectSweep({

            bar,

            previous,

            atrValue,

            highLevels,

            lowLevels

          });


        if (
          sweep
        ) {

          pending = {

            ...sweep,

            sweepIndex:
              i,

            sweepTime:
              bar.ts,

            sweepOpen:
              bar.open,

            sweepHigh:
              bar.high,

            sweepLow:
              bar.low,

            sweepClose:
              bar.close,

            atrAtSweep:
              atrValue

          };


          if (
            sweep.level.dynamicRef
          ) {

            sweep.level.dynamicRef.used =
              true;

          }


          if (
            sweep.level.staticKey
          ) {

            usedStaticLevels.add(
              sweep.level.staticKey
            );

          }

        }

      }

    }


    /* ===================================================
       CONFIRM A NEW PIVOT

       IMPORTANT:
       This happens AFTER sweep detection.

       Therefore today's candle cannot sweep a pivot that
       only became known at this candle close.
    =================================================== */

    const pivotIndex =
      i -
      PIVOT_RIGHT;


    if (
      pivotIndex >
      PIVOT_LEFT
    ) {

      if (
        isPivotHigh(

          bars,

          pivotIndex,

          PIVOT_LEFT,

          PIVOT_RIGHT

        )
      ) {

        const level = {

          side:
            "HIGH",

          type:
            "M5_SWING_HIGH",

          name:
            "M5 Swing High",

          price:
            bars[
              pivotIndex
            ].high,

          importance:
            1,

          pivotIndex,

          createdIndex:
            i,

          used:
            false

        };


        level.dynamicRef =
          level;


        pivotHighs.push(
          level
        );

      }


      if (
        isPivotLow(

          bars,

          pivotIndex,

          PIVOT_LEFT,

          PIVOT_RIGHT

        )
      ) {

        const level = {

          side:
            "LOW",

          type:
            "M5_SWING_LOW",

          name:
            "M5 Swing Low",

          price:
            bars[
              pivotIndex
            ].low,

          importance:
            1,

          pivotIndex,

          createdIndex:
            i,

          used:
            false

        };


        level.dynamicRef =
          level;


        pivotLows.push(
          level
        );

      }

    }

  }


  /* =====================================================
     METRICS
  ===================================================== */

  const metrics =
    calculateMetrics({

      trades,

      config,

      finalBalance:
        balance,

      equityCurve,

      rejectedSignals

    });


  return {

    metrics,

    equityCurve,

    trades:
      trades
        .slice()
        .reverse()
        .slice(
          0,
          300
        )

  };

}


/* =========================================================
   SWEEP DETECTION
========================================================= */

function detectSweep({

  bar,

  previous,

  atrValue,

  highLevels,

  lowLevels

}) {

  const minimumPenetration =
    Math.max(

      atrValue *
      0.025,

      bar.close *
      0.000015

    );


  const highSweeps =
    highLevels

      .filter(
        level => {

          /*
            Price should have been at/below liquidity
            before sweeping it.
          */

          const previouslyBelow =

            previous.close <=

            level.price

            +

            atrValue *
            0.12;


          const penetrated =

            bar.high >=

            level.price

            +

            minimumPenetration;


          const rejected =

            bar.close <
            level.price;


          return (

            previouslyBelow

            &&

            penetrated

            &&

            rejected

          );

        }
      );


  const lowSweeps =
    lowLevels

      .filter(
        level => {

          const previouslyAbove =

            previous.close >=

            level.price

            -

            atrValue *
            0.12;


          const penetrated =

            bar.low <=

            level.price

            -

            minimumPenetration;


          const rejected =

            bar.close >
            level.price;


          return (

            previouslyAbove

            &&

            penetrated

            &&

            rejected

          );

        }
      );


  const bestHigh =
    chooseLevel(

      highSweeps,

      previous.close,

      atrValue

    );


  const bestLow =
    chooseLevel(

      lowSweeps,

      previous.close,

      atrValue

    );


  if (
    !bestHigh

    &&

    !bestLow
  ) {

    return null;

  }


  /* =====================================================
     OUTSIDE BAR THAT SWEEPS BOTH SIDES
  ===================================================== */

  if (
    bestHigh

    &&

    bestLow
  ) {

    const range =
      Math.max(

        bar.high -
        bar.low,

        1e-9

      );


    const upperWick =

      bar.high

      -

      Math.max(
        bar.open,
        bar.close
      );


    const lowerWick =

      Math.min(
        bar.open,
        bar.close
      )

      -

      bar.low;


    const upperRatio =
      upperWick /
      range;


    const lowerRatio =
      lowerWick /
      range;


    if (
      Math.abs(
        upperRatio -
        lowerRatio
      ) <
      0.08
    ) {

      return null;

    }


    if (
      upperRatio >
      lowerRatio
    ) {

      return {

        direction:
          "SELL",

        level:
          bestHigh

      };

    }


    return {

      direction:
        "BUY",

      level:
        bestLow

    };

  }


  if (
    bestHigh
  ) {

    return {

      direction:
        "SELL",

      level:
        bestHigh

    };

  }


  return {

    direction:
      "BUY",

    level:
      bestLow

  };

}


/* =========================================================
   CHOOSE STRONGEST LEVEL
========================================================= */

function chooseLevel(
  levels,
  previousPrice,
  atrValue
) {

  if (
    !levels.length
  ) {

    return null;

  }


  return levels

    .slice()

    .sort(
      (
        a,
        b
      ) => {

        const distanceA =

          Math.abs(

            a.price -
            previousPrice

          )

          /

          Math.max(
            atrValue,
            1e-9
          );


        const distanceB =

          Math.abs(

            b.price -
            previousPrice

          )

          /

          Math.max(
            atrValue,
            1e-9
          );


        const scoreA =

          a.importance *
          12

          -

          distanceA;


        const scoreB =

          b.importance *
          12

          -

          distanceB;


        return (
          scoreB -
          scoreA
        );

      }
    )[0];

}


/* =========================================================
   FOLLOW-THROUGH CONFIRMATION
========================================================= */

function confirmSweep({

  pending,

  bar,

  atrValue

}) {

  const level =
    pending.level.price;


  const away =

    Math.max(

      atrValue *
      0.03,

      level *
      0.000015

    );


  if (
    pending.direction ===
    "SELL"
  ) {

    const closeAway =

      bar.close <=

      level -
      away;


    const lowerClose =

      bar.close <
      pending.sweepClose;


    const bearishBody =

      bar.close <
      bar.open;


    return (

      closeAway

      &&

      lowerClose

      &&

      (
        bearishBody

        ||

        bar.close <
        bar.low

        +

        (
          bar.high -
          bar.low
        )

        *
        0.55
      )

    );

  }


  const closeAway =

    bar.close >=

    level +
    away;


  const higherClose =

    bar.close >
    pending.sweepClose;


  const bullishBody =

    bar.close >
    bar.open;


  return (

    closeAway

    &&

    higherClose

    &&

    (
      bullishBody

      ||

      bar.close >
      bar.low

      +

      (
        bar.high -
        bar.low
      )

      *
      0.45
    )

  );

}


/* =========================================================
   QUALITY SCORE
========================================================= */

function calculateQuality({

  pending,

  confirmationBar,

  confirmationIndex,

  atrValue,

  bars,

  m5States,

  m15,

  m15States,

  h1,

  h1States,

  delta3,

  delta9

}) {

  let score =
    35;


  const reasons = [

    "Confirmed liquidity sweep"

  ];


  const direction =
    pending.direction;


  const sweepBar =
    bars[
      pending.sweepIndex
    ];


  /* =====================================================
     LIQUIDITY IMPORTANCE
  ===================================================== */

  const importanceBonus =
    clamp(

      (
        pending.level.importance -
        1
      )

      *
      18,

      0,

      8

    );


  score +=
    importanceBonus;


  if (
    importanceBonus >
    0
  ) {

    reasons.push(
      pending.level.name
    );

  }


  /* =====================================================
     WICK REJECTION
  ===================================================== */

  const range =
    Math.max(

      sweepBar.high -
      sweepBar.low,

      1e-9

    );


  let rejectionRatio;


  if (
    direction ===
    "SELL"
  ) {

    rejectionRatio =

      (
        sweepBar.high

        -

        Math.max(

          sweepBar.open,

          sweepBar.close

        )
      )

      /

      range;

  }

  else {

    rejectionRatio =

      (
        Math.min(

          sweepBar.open,

          sweepBar.close

        )

        -

        sweepBar.low
      )

      /

      range;

  }


  const rejectionBonus =
    clamp(

      rejectionRatio *
      20,

      0,

      14

    );


  score +=
    rejectionBonus;


  if (
    rejectionRatio >=
    0.3
  ) {

    reasons.push(
      "Strong sweep wick rejection"
    );

  }


  /* =====================================================
     M5 STRUCTURE
  ===================================================== */

  const m5 =
    m5States[
      confirmationIndex
    ];


  const m5Pass =
    stateSupports(

      m5,

      direction

    );


  if (
    m5Pass
  ) {

    score +=
      10;


    reasons.push(
      "M5 structure aligned"
    );

  }


  /* =====================================================
     COMPLETED M15
  ===================================================== */

  const confirmTime =

    confirmationBar.ts

    +

    BAR_MS;


  const m15State =
    completedStateAt(

      m15,

      m15States,

      confirmTime,

      15

    );


  const m15Pass =
    stateSupports(

      m15State,

      direction

    );


  if (
    m15Pass
  ) {

    score +=
      10;


    reasons.push(
      "M15 structure aligned"
    );

  }


  /* =====================================================
     COMPLETED H1
  ===================================================== */

  const h1State =
    completedStateAt(

      h1,

      h1States,

      confirmTime,

      60

    );


  const h1Pass =
    stateSupports(

      h1State,

      direction

    );


  if (
    h1Pass
  ) {

    score +=
      5;


    reasons.push(
      "H1 structure aligned"
    );

  }


  /* =====================================================
     DELTA DIRECTION
  ===================================================== */

  const fastDelta =
    delta3[
      confirmationIndex
    ];


  const slowDelta =
    delta9[
      confirmationIndex
    ];


  const deltaPass =

    direction ===
    "SELL"

      ?

      fastDelta <
      -3

      :

      fastDelta >
      3;


  if (
    deltaPass
  ) {

    score +=
      10;


    reasons.push(
      "Short-term delta aligned"
    );

  }


  /* =====================================================
     DELTA ACCELERATION
  ===================================================== */

  const deltaAcceleration =

    direction ===
    "SELL"

      ?

      fastDelta <
      slowDelta -
      2

      :

      fastDelta >
      slowDelta +
      2;


  if (
    deltaAcceleration
  ) {

    score +=
      5;


    reasons.push(
      "Delta acceleration"
    );

  }


  /* =====================================================
     VOLATILITY / DISPLACEMENT
  ===================================================== */

  const confirmRange =

    confirmationBar.high

    -

    confirmationBar.low;


  if (
    confirmRange >=
    atrValue *
    0.8
  ) {

    score +=
      4;


    reasons.push(
      "Confirmation displacement"
    );

  }


  /* =====================================================
     SESSION
  ===================================================== */

  const session =
    sessionContext(
      confirmationBar.ts
    );


  if (
    session.majorOpeningWindow
  ) {

    score +=
      5;


    reasons.push(
      `${session.name} opening liquidity window`
    );

  }

  else if (
    session.majorActive
  ) {

    score +=
      2;

  }


  score =
    clamp(
      score,
      0,
      100
    );


  return {

    score:
      round(
        score,
        1
      ),

    reasons,

    checks: {

      m5:
        m5Pass,

      m15:
        m15Pass,

      h1:
        h1Pass,

      delta:
        deltaPass,

      deltaAcceleration,

      rejectionRatio:
        round(
          rejectionRatio,
          3
        )

    }

  };

}


/* =========================================================
   SIMULATE TRADE
========================================================= */

function simulateTrade({

  bars,

  entryIndex,

  pending,

  quality,

  config,

  atrValue,

  riskAmount,

  startingBalance

}) {

  const direction =
    pending.direction;


  const rawEntry =
    bars[
      entryIndex
    ].open;


  /*
    Adverse entry adjustment.
  */

  const entryCost =

    config.spread /
    2

    +

    config.slippage;


  const entry =

    direction ===
    "BUY"

      ?

      rawEntry +
      entryCost

      :

      rawEntry -
      entryCost;


  const buffer =

    Math.max(

      atrValue *
      0.25,

      entry *
      0.00008

    );


  let stopLoss;


  if (
    direction ===
    "SELL"
  ) {

    stopLoss =

      Math.max(

        pending.sweepHigh,

        pending.level.price

      )

      +

      buffer;

  }

  else {

    stopLoss =

      Math.min(

        pending.sweepLow,

        pending.level.price

      )

      -

      buffer;

  }


  let riskDistance =
    Math.abs(

      entry -
      stopLoss

    );


  /*
    Prevent ridiculously tiny stops.
  */

  const minimumRisk =

    atrValue *
    0.35;


  if (
    riskDistance <
    minimumRisk
  ) {

    if (
      direction ===
      "BUY"
    ) {

      stopLoss =
        entry -
        minimumRisk;

    }

    else {

      stopLoss =
        entry +
        minimumRisk;

    }


    riskDistance =
      minimumRisk;

  }


  const tp1 =

    direction ===
    "BUY"

      ?

      entry

      +

      riskDistance *
      config.tp1R

      :

      entry

      -

      riskDistance *
      config.tp1R;


  const tp2 =

    direction ===
    "BUY"

      ?

      entry

      +

      riskDistance *
      config.tp2R

      :

      entry

      -

      riskDistance *
      config.tp2R;


  let tp1Hit =
    false;


  let realizedR =
    null;


  let exitPrice =
    null;


  let exitIndex =
    null;


  let exitReason =
    null;


  const lastIndex =
    Math.min(

      bars.length - 1,

      entryIndex

      +

      config.maxHoldBars

    );


  /* =====================================================
     WALK FORWARD
  ===================================================== */

  for (

    let i =
      entryIndex;

    i <=
    lastIndex;

    i++

  ) {

    const bar =
      bars[i];


    /* ===================================================
       BUY
    =================================================== */

    if (
      direction ===
      "BUY"
    ) {

      const activeStop =

        tp1Hit

          ?

          entry

          :

          stopLoss;


      /*
        Conservative intrabar assumption:
        stop is checked before profit targets.
      */

      if (
        bar.low <=
        activeStop
      ) {

        if (
          tp1Hit
        ) {

          realizedR =

            0.5 *
            config.tp1R;


          exitPrice =
            entry;


          exitReason =
            "BREAKEVEN_AFTER_TP1";

        }

        else {

          realizedR =
            -1;


          exitPrice =
            stopLoss;


          exitReason =
            "SL";

        }


        exitIndex =
          i;


        break;

      }


      if (
        !tp1Hit

        &&

        bar.high >=
        tp1
      ) {

        tp1Hit =
          true;

      }


      if (
        tp1Hit

        &&

        bar.high >=
        tp2
      ) {

        realizedR =

          0.5 *
          config.tp1R

          +

          0.5 *
          config.tp2R;


        exitPrice =
          tp2;


        exitReason =
          "TP2";


        exitIndex =
          i;


        break;

      }

    }


    /* ===================================================
       SELL
    =================================================== */

    else {

      const activeStop =

        tp1Hit

          ?

          entry

          :

          stopLoss;


      if (
        bar.high >=
        activeStop
      ) {

        if (
          tp1Hit
        ) {

          realizedR =

            0.5 *
            config.tp1R;


          exitPrice =
            entry;


          exitReason =
            "BREAKEVEN_AFTER_TP1";

        }

        else {

          realizedR =
            -1;


          exitPrice =
            stopLoss;


          exitReason =
            "SL";

        }


        exitIndex =
          i;


        break;

      }


      if (
        !tp1Hit

        &&

        bar.low <=
        tp1
      ) {

        tp1Hit =
          true;

      }


      if (
        tp1Hit

        &&

        bar.low <=
        tp2
      ) {

        realizedR =

          0.5 *
          config.tp1R

          +

          0.5 *
          config.tp2R;


        exitPrice =
          tp2;


        exitReason =
          "TP2";


        exitIndex =
          i;


        break;

      }

    }

  }


  /* =====================================================
     TIME EXIT
  ===================================================== */

  if (
    realizedR ===
    null
  ) {

    exitIndex =
      lastIndex;


    exitPrice =
      bars[
        exitIndex
      ].close;


    const floatingR =

      direction ===
      "BUY"

        ?

        (
          exitPrice -
          entry
        )

        /
        riskDistance

        :

        (
          entry -
          exitPrice
        )

        /
        riskDistance;


    if (
      tp1Hit
    ) {

      realizedR =

        0.5 *
        config.tp1R

        +

        0.5 *
        floatingR;

    }

    else {

      realizedR =
        floatingR;

    }


    realizedR =
      clamp(

        realizedR,

        -1,

        config.tp2R

      );


    exitReason =
      "TIME_EXIT";

  }


  /* =====================================================
     APPROXIMATE EXTRA EXIT COST
  ===================================================== */

  const exitCost =

    config.spread /
    2

    +

    config.slippage;


  const costR =

    riskDistance > 0

      ?

      exitCost /
      riskDistance

      :

      0;


  realizedR -=
    costR;


  /* =====================================================
     BALANCE
  ===================================================== */

  const pnl =

    riskAmount

    *

    realizedR;


  const endingBalance =

    startingBalance

    +

    pnl;


  return {

    id:
      `BT-${entryIndex}-${pending.sweepIndex}`,

    direction,

    liquidity:
      pending.level.name,

    liquidityType:
      pending.level.type,

    liquidityLevel:
      round(
        pending.level.price,
        3
      ),

    score:
      quality.score,

    reasons:
      quality.reasons,

    entry:
      round(
        entry,
        3
      ),

    stopLoss:
      round(
        stopLoss,
        3
      ),

    tp1:
      round(
        tp1,
        3
      ),

    tp2:
      round(
        tp2,
        3
      ),

    riskDistance:
      round(
        riskDistance,
        3
      ),

    riskAmount:
      round(
        riskAmount,
        2
      ),

    r:
      round(
        realizedR,
        3
      ),

    pnl:
      round(
        pnl,
        2
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

    tp1Hit,

    exitReason,

    entryTime:
      new Date(
        bars[
          entryIndex
        ].ts
      )
        .toISOString(),

    exitTime:
      new Date(
        bars[
          exitIndex
        ].ts
      )
        .toISOString(),

    holdBars:

      exitIndex

      -

      entryIndex

      +

      1,

    entryIndex,

    exitIndex

  };

}


/* =========================================================
   METRICS
========================================================= */

function calculateMetrics({

  trades,

  config,

  finalBalance,

  equityCurve,

  rejectedSignals

}) {

  const total =
    trades.length;


  const wins =
    trades.filter(
      trade =>
        trade.r >
        0.001
    ).length;


  const losses =
    trades.filter(
      trade =>
        trade.r <
        -0.001
    ).length;


  const breakeven =
    total -
    wins -
    losses;


  const grossProfitR =
    sum(

      trades

        .filter(
          t =>
            t.r > 0
        )

        .map(
          t =>
            t.r
        )

    );


  const grossLossR =
    Math.abs(

      sum(

        trades

          .filter(
            t =>
              t.r < 0
          )

          .map(
            t =>
              t.r
          )

      )

    );


  const totalR =
    sum(

      trades.map(
        trade =>
          trade.r
      )

    );


  const profitFactor =

    grossLossR > 0

      ?

      grossProfitR /
      grossLossR

      :

      grossProfitR > 0

        ?

        999

        :

        0;


  const averageR =

    total

      ?

      totalR /
      total

      :

      0;


  const winRate =

    total

      ?

      wins /
      total *
      100

      :

      0;


  /* =====================================================
     DRAWDOWN
  ===================================================== */

  let peak =
    config.initialBalance;


  let maxDrawdownPct =
    0;


  let maxDrawdownMoney =
    0;


  for (
    const point of equityCurve
  ) {

    peak =
      Math.max(

        peak,

        point.balance

      );


    const ddMoney =

      peak -
      point.balance;


    const ddPct =

      peak > 0

        ?

        ddMoney /
        peak *
        100

        :

        0;


    maxDrawdownPct =
      Math.max(

        maxDrawdownPct,

        ddPct

      );


    maxDrawdownMoney =
      Math.max(

        maxDrawdownMoney,

        ddMoney

      );

  }


  /* =====================================================
     CONSECUTIVE LOSSES
  ===================================================== */

  let currentLosses =
    0;


  let maxConsecutiveLosses =
    0;


  for (
    const trade of trades
  ) {

    if (
      trade.r < 0
    ) {

      currentLosses++;


      maxConsecutiveLosses =
        Math.max(

          maxConsecutiveLosses,

          currentLosses

        );

    }

    else {

      currentLosses =
        0;

    }

  }


  const buys =
    trades.filter(
      t =>
        t.direction ===
        "BUY"
    ).length;


  const sells =
    trades.filter(
      t =>
        t.direction ===
        "SELL"
    ).length;


  const tp2 =
    trades.filter(
      t =>
        t.exitReason ===
        "TP2"
    ).length;


  const sl =
    trades.filter(
      t =>
        t.exitReason ===
        "SL"
    ).length;


  const breakEvenAfterTp1 =
    trades.filter(
      t =>
        t.exitReason ===
        "BREAKEVEN_AFTER_TP1"
    ).length;


  const avgHoldBars =

    total

      ?

      avg(

        trades.map(
          t =>
            t.holdBars
        )

      )

      :

      0;


  const returnPct =

    (
      finalBalance -
      config.initialBalance
    )

    /

    config.initialBalance

    *

    100;


  return {

    trades:
      total,

    wins,

    losses,

    breakeven,

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

    averageR:
      round(
        averageR,
        3
      ),

    initialBalance:
      round(
        config.initialBalance,
        2
      ),

    endingBalance:
      round(
        finalBalance,
        2
      ),

    netProfit:
      round(

        finalBalance

        -

        config.initialBalance,

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

    maxDrawdownMoney:
      round(
        maxDrawdownMoney,
        2
      ),

    maxConsecutiveLosses,

    averageHoldBars:
      round(
        avgHoldBars,
        1
      ),

    averageHoldMinutes:
      round(
        avgHoldBars *
        5,
        1
      ),

    buys,

    sells,

    tp2Hits:
      tp2,

    stopLosses:
      sl,

    tp1Breakevens:
      breakEvenAfterTp1,

    rejectedSignals

  };

}


/* =========================================================
   DAILY / ASIA CONTEXT
========================================================= */

function buildDailyContext(
  bars
) {

  const days =
    new Map();


  for (
    const bar of bars
  ) {

    const key =
      utcDateKey(
        bar.ts
      );


    if (
      !days.has(
        key
      )
    ) {

      days.set(
        key,
        []
      );

    }


    days
      .get(
        key
      )
      .push(
        bar
      );

  }


  const keys =
    Array
      .from(
        days.keys()
      )
      .sort();


  const previousDay =
    new Map();


  const asia =
    new Map();


  for (

    let i = 0;

    i <
    keys.length;

    i++

  ) {

    const key =
      keys[i];


    const rows =
      days.get(
        key
      );


    /* ===================================================
       PREVIOUS TRADING DAY
    =================================================== */

    if (
      i > 0
    ) {

      const previousRows =
        days.get(
          keys[
            i - 1
          ]
        );


      previousDay.set(
        key,
        {

          high:
            Math.max(

              ...previousRows.map(
                x =>
                  x.high
              )

            ),

          low:
            Math.min(

              ...previousRows.map(
                x =>
                  x.low
              )

            )

        }
      );

    }


    /* ===================================================
       ASIA RANGE
       Tokyo 09:00-18:00 = UTC 00:00-09:00
    =================================================== */

    const asiaRows =
      rows.filter(
        row => {

          const hour =
            new Date(
              row.ts
            )
              .getUTCHours();


          return (

            hour >= 0

            &&

            hour < 9

          );

        }
      );


    if (
      asiaRows.length >= 30
    ) {

      asia.set(
        key,
        {

          high:
            Math.max(

              ...asiaRows.map(
                x =>
                  x.high
              )

            ),

          low:
            Math.min(

              ...asiaRows.map(
                x =>
                  x.low
              )

            )

        }
      );

    }

  }


  return {

    previousDay,

    asia

  };

}


function getStaticLevels({

  bar,

  context,

  used

}) {

  const key =
    utcDateKey(
      bar.ts
    );


  const out =
    [];


  const previous =
    context.previousDay
      .get(
        key
      );


  if (
    previous
  ) {

    pushStaticLevel({

      out,

      used,

      staticKey:
        `${key}-PDH`,

      name:
        "Previous Day High",

      type:
        "PDH",

      side:
        "HIGH",

      price:
        previous.high,

      importance:
        1.35

    });


    pushStaticLevel({

      out,

      used,

      staticKey:
        `${key}-PDL`,

      name:
        "Previous Day Low",

      type:
        "PDL",

      side:
        "LOW",

      price:
        previous.low,

      importance:
        1.35

    });

  }


  /*
    Asia levels only become usable after
    the Asia calculation window has completed.
  */

  const hour =
    new Date(
      bar.ts
    )
      .getUTCHours();


  if (
    hour >= 9
  ) {

    const asia =
      context.asia
        .get(
          key
        );


    if (
      asia
    ) {

      pushStaticLevel({

        out,

        used,

        staticKey:
          `${key}-ASIA-H`,

        name:
          "Asia High",

        type:
          "ASIA_HIGH",

        side:
          "HIGH",

        price:
          asia.high,

        importance:
          1.3

      });


      pushStaticLevel({

        out,

        used,

        staticKey:
          `${key}-ASIA-L`,

        name:
          "Asia Low",

        type:
          "ASIA_LOW",

        side:
          "LOW",

        price:
          asia.low,

        importance:
          1.3

      });

    }

  }


  return out;

}


function pushStaticLevel({

  out,

  used,

  staticKey,

  name,

  type,

  side,

  price,

  importance

}) {

  if (
    used.has(
      staticKey
    )
  ) {

    return;

  }


  if (
    !Number.isFinite(
      price
    )
  ) {

    return;

  }


  out.push({

    staticKey,

    name,

    type,

    side,

    price,

    importance

  });

}


/* =========================================================
   SESSION CONTEXT
========================================================= */

function sessionContext(
  timestamp
) {

  const date =
    new Date(
      timestamp
    );


  const london =
    localParts(

      date,

      "Europe/London"

    );


  const newYork =
    localParts(

      date,

      "America/New_York"

    );


  const londonMinute =

    london.hour *
    60

    +

    london.minute;


  const nyMinute =

    newYork.hour *
    60

    +

    newYork.minute;


  const londonActive =

    london.weekday >= 1

    &&

    london.weekday <= 5

    &&

    londonMinute >=
    8 *
    60

    &&

    londonMinute <
    17 *
    60;


  const nyActive =

    newYork.weekday >= 1

    &&

    newYork.weekday <= 5

    &&

    nyMinute >=
    8 *
    60

    &&

    nyMinute <
    17 *
    60;


  const londonOpening =

    londonActive

    &&

    londonMinute <

    9 *
    60 +
    30;


  const nyOpening =

    nyActive

    &&

    nyMinute <

    9 *
    60 +
    30;


  if (
    londonOpening
  ) {

    return {

      name:
        "London",

      majorOpeningWindow:
        true,

      majorActive:
        true

    };

  }


  if (
    nyOpening
  ) {

    return {

      name:
        "New York",

      majorOpeningWindow:
        true,

      majorActive:
        true

    };

  }


  if (
    londonActive
  ) {

    return {

      name:
        "London",

      majorOpeningWindow:
        false,

      majorActive:
        true

    };

  }


  if (
    nyActive
  ) {

    return {

      name:
        "New York",

      majorOpeningWindow:
        false,

      majorActive:
        true

    };

  }


  return {

    name:
      "Other",

    majorOpeningWindow:
      false,

    majorActive:
      false

  };

}


/* =========================================================
   TIMEFRAME STATE
========================================================= */

function buildStateSeries(
  bars
) {

  const closes =
    bars.map(
      bar =>
        bar.close
    );


  const e20 =
    ema(
      closes,
      20
    );


  const e50 =
    ema(
      closes,
      50
    );


  const e200 =
    ema(
      closes,
      200
    );


  const r =
    rsi(
      closes,
      14
    );


  return bars.map(
    (
      bar,
      i
    ) => {

      let score =
        0;


      if (
        bar.close >
        e20[i]
      ) {

        score++;

      }

      else {

        score--;

      }


      if (
        e20[i] >
        e50[i]
      ) {

        score++;

      }

      else {

        score--;

      }


      if (
        e50[i] >
        e200[i]
      ) {

        score++;

      }

      else {

        score--;

      }


      if (
        r[i] >
        55
      ) {

        score +=
          0.5;

      }


      if (
        r[i] <
        45
      ) {

        score -=
          0.5;

      }


      let bias =
        "NEUTRAL";


      if (
        score >=
        1.5
      ) {

        bias =
          "BULLISH";

      }


      if (
        score <=
        -1.5
      ) {

        bias =
          "BEARISH";

      }


      return {

        bias,

        score:
          round(
            score,
            2
          ),

        rsi:
          round(
            r[i],
            1
          )

      };

    }
  );

}


function stateSupports(
  state,
  direction
) {

  if (
    !state
  ) {

    return false;

  }


  if (
    direction ===
    "SELL"
  ) {

    return (

      state.bias ===
      "BEARISH"

      ||

      state.score <
      0

    );

  }


  return (

    state.bias ===
    "BULLISH"

    ||

    state.score >
    0

  );

}


/* =========================================================
   COMPLETED HTF STATE
========================================================= */

function completedStateAt(

  tfBars,

  states,

  timestamp,

  minutes

) {

  const duration =
    minutes *
    60_000;


  let low =
    0;


  let high =
    tfBars.length -
    1;


  let answer =
    -1;


  while (
    low <= high
  ) {

    const middle =
      Math.floor(

        (
          low +
          high
        )

        /
        2

      );


    const completedAt =

      tfBars[
        middle
      ].ts

      +

      duration;


    if (
      completedAt <=
      timestamp
    ) {

      answer =
        middle;


      low =
        middle +
        1;

    }

    else {

      high =
        middle -
        1;

    }

  }


  return (

    answer >= 0

      ?

      states[
        answer
      ]

      :

      null

  );

}


/* =========================================================
   DELTA PROXY
========================================================= */

function buildDeltaSeries(
  bars
) {

  return bars.map(
    bar => {

      const range =
        Math.max(

          bar.high -
          bar.low,

          1e-9

        );


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


      const body =

        (
          bar.close -
          bar.open
        )

        /

        range;


      const delta =

        (
          closeLocation *
          0.58

          +

          body *
          0.42
        )

        *
        100;


      return clamp(

        delta,

        -100,

        100

      );

    }
  );

}


/* =========================================================
   RESAMPLE
========================================================= */

function resample(
  bars,
  minutes
) {

  const size =
    minutes *
    60_000;


  const out =
    [];


  let current =
    null;


  for (
    const bar of bars
  ) {

    const bucket =

      Math.floor(

        bar.ts /
        size

      )

      *
      size;


    if (
      !current

      ||

      current.ts !==
      bucket
    ) {

      if (
        current
      ) {

        out.push(
          current
        );

      }


      current = {

        ts:
          bucket,

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
          ||
          0

      };

    }

    else {

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
        bar.volume
        ||
        0;

    }

  }


  if (
    current
  ) {

    out.push(
      current
    );

  }


  return out;

}


/* =========================================================
   PIVOTS
========================================================= */

function isPivotHigh(

  bars,

  index,

  left,

  right

) {

  const value =
    bars[
      index
    ].high;


  for (

    let i =
      index -
      left;

    i <=
      index +
      right;

    i++

  ) {

    if (
      i === index
    ) {

      continue;

    }


    if (
      bars[i].high >=
      value
    ) {

      return false;

    }

  }


  return true;

}


function isPivotLow(

  bars,

  index,

  left,

  right

) {

  const value =
    bars[
      index
    ].low;


  for (

    let i =
      index -
      left;

    i <=
      index +
      right;

    i++

  ) {

    if (
      i === index
    ) {

      continue;

    }


    if (
      bars[i].low <=
      value
    ) {

      return false;

    }

  }


  return true;

}


function pruneLevels(
  levels,
  currentIndex
) {

  while (
    levels.length

    &&

    currentIndex

    -

    levels[0].pivotIndex

    >

    LEVEL_MAX_AGE
  ) {

    levels.shift();

  }

}


/* =========================================================
   ATR
========================================================= */

function atr(
  bars,
  period = 14
) {

  const tr =
    bars.map(
      (
        bar,
        i
      ) => {

        if (
          i === 0
        ) {

          return (
            bar.high -
            bar.low
          );

        }


        const previousClose =
          bars[
            i - 1
          ].close;


        return Math.max(

          bar.high -
          bar.low,

          Math.abs(
            bar.high -
            previousClose
          ),

          Math.abs(
            bar.low -
            previousClose
          )

        );

      }
    );


  const out =
    new Array(
      bars.length
    )
      .fill(
        null
      );


  if (
    bars.length <
    period
  ) {

    return out;

  }


  let total =
    0;


  for (

    let i = 0;

    i <
    period;

    i++

  ) {

    total +=
      tr[i];

  }


  let previous =
    total /
    period;


  out[
    period - 1
  ] =
    previous;


  for (

    let i =
      period;

    i <
    tr.length;

    i++

  ) {

    previous =

      (
        previous *
        (
          period -
          1
        )

        +

        tr[i]
      )

      /

      period;


    out[i] =
      previous;

  }


  return out;

}


/* =========================================================
   EMA
========================================================= */

function ema(
  values,
  period
) {

  const out =
    new Array(
      values.length
    )
      .fill(
        null
      );


  if (
    !values.length
  ) {

    return out;

  }


  const k =
    2 /
    (
      period +
      1
    );


  let previous =
    values[0];


  out[0] =
    previous;


  for (

    let i = 1;

    i <
    values.length;

    i++

  ) {

    previous =

      values[i] *
      k

      +

      previous *
      (
        1 -
        k
      );


    out[i] =
      previous;

  }


  return out;

}


/* =========================================================
   RSI
========================================================= */

function rsi(
  values,
  period = 14
) {

  const out =
    new Array(
      values.length
    )
      .fill(
        50
      );


  if (
    values.length <=
    period
  ) {

    return out;

  }


  let gains =
    0;


  let losses =
    0;


  for (

    let i = 1;

    i <=
    period;

    i++

  ) {

    const difference =

      values[i]

      -

      values[
        i - 1
      ];


    gains +=
      Math.max(
        difference,
        0
      );


    losses +=
      Math.max(
        -difference,
        0
      );

  }


  let averageGain =
    gains /
    period;


  let averageLoss =
    losses /
    period;


  for (

    let i =
      period;

    i <
    values.length;

    i++

  ) {

    if (
      i >
      period
    ) {

      const difference =

        values[i]

        -

        values[
          i - 1
        ];


      averageGain =

        (
          averageGain *
          (
            period -
            1
          )

          +

          Math.max(
            difference,
            0
          )
        )

        /

        period;


      averageLoss =

        (
          averageLoss *
          (
            period -
            1
          )

          +

          Math.max(
            -difference,
            0
          )
        )

        /

        period;

    }


    out[i] =

      averageLoss === 0

        ?

        100

        :

        100

        -

        100

        /

        (
          1

          +

          averageGain /
          averageLoss
        );

  }


  return out;

}


/* =========================================================
   ROLLING AVERAGE
========================================================= */

function rollingAverage(
  values,
  period
) {

  const out =
    new Array(
      values.length
    )
      .fill(
        0
      );


  let running =
    0;


  for (

    let i = 0;

    i <
    values.length;

    i++

  ) {

    running +=
      values[i];


    if (
      i >= period
    ) {

      running -=
        values[
          i -
          period
        ];

    }


    const count =
      Math.min(

        i + 1,

        period

      );


    out[i] =
      running /
      count;

  }


  return out;

}


/* =========================================================
   LOCAL TIME PARTS
========================================================= */

function localParts(
  date,
  timeZone
) {

  const parts =
    new Intl.DateTimeFormat(

      "en-US",

      {

        timeZone,

        hour:
          "2-digit",

        minute:
          "2-digit",

        weekday:
          "short",

        hourCycle:
          "h23"

      }

    )
      .formatToParts(
        date
      );


  const object =
    {};


  for (
    const part of parts
  ) {

    if (
      part.type !==
      "literal"
    ) {

      object[
        part.type
      ] =
        part.value;

    }

  }


  const weekdays = {

    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6

  };


  return {

    hour:
      Number(
        object.hour
      ),

    minute:
      Number(
        object.minute
      ),

    weekday:
      weekdays[
        object.weekday
      ]

  };

}


/* =========================================================
   UTILITIES
========================================================= */

function envNumber(
  name,
  fallback
) {

  const value =
    Number(
      process.env[
        name
      ]
    );


  return Number.isFinite(
    value
  )

    ?

    value

    :

    fallback;

}


function queryNumber(
  value,
  fallback,
  minimum,
  maximum
) {

  const n =
    Number(
      value
    );


  if (
    !Number.isFinite(
      n
    )
  ) {

    return fallback;

  }


  return clamp(

    n,

    minimum,

    maximum

  );

}


function num(
  value
) {

  const n =
    Number(
      value
    );


  return Number.isFinite(
    n
  )

    ?

    n

    :

    0;

}


function round(
  value,
  decimals = 2
) {

  const n =
    Number(
      value
    );


  if (
    !Number.isFinite(
      n
    )
  ) {

    return null;

  }


  const multiplier =
    10 **
    decimals;


  return Math.round(

    n *
    multiplier

  )

  /

  multiplier;

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


function sum(
  values
) {

  return values.reduce(

    (
      total,
      value
    ) =>

      total

      +

      (
        Number.isFinite(
          value
        )

          ?

          value

          :

          0
      ),

    0

  );

}


function avg(
  values
) {

  return values.length

    ?

    sum(
      values
    )
    /
    values.length

    :

    0;

}


function utcDateKey(
  timestamp
) {

  return new Date(
    timestamp
  )
    .toISOString()
    .slice(
      0,
      10
    );

}


function tdDate(
  date
) {

  return date
    .toISOString()
    .replace(
      "T",
      " "
    )
    .slice(
      0,
      19
    );

}