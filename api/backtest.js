/* ================================================================
   TYSON TRADE AI
   TREND PULLBACK V1.2
   MULTI-MODE BACKTEST ENGINE
   ---------------------------------------------------------------
   /api/backtest.js

   SYMBOL
   ------
   XAU/USD

   PROVIDER
   --------
   Twelve Data

   ENV
   ---
   TWELVE_DATA_API_KEY_4
   fallback:
   TWELVE_DATA_API_KEY

   TIMEFRAMES
   ----------
   M5  execution
   M15 local trend
   H1  primary trend
   H4  macro trend

   MODES
   -----
   STRICT
   BALANCED
   ACTIVE

   BACKTEST DESIGN
   ---------------
   - completed candles only
   - completed HTF candles only
   - next M5 open entry
   - structural + ATR stop
   - R target
   - conservative same-bar collision
   - optional breakeven
   - fixed fractional risk
   - 70/30 chronological validation
================================================================ */


/* ================================================================
   GLOBAL
================================================================ */

const TD_KEY =
  process.env.TWELVE_DATA_API_KEY_4 ||
  process.env.TWELVE_DATA_API_KEY;


const TD_BASE =
  "https://api.twelvedata.com/time_series";


const SYMBOL =
  "XAU/USD";


const TF = {

  m5: {
    interval: "5min",
    ms: 5 * 60 * 1000
  },

  m15: {
    interval: "15min",
    ms: 15 * 60 * 1000
  },

  h1: {
    interval: "1h",
    ms: 60 * 60 * 1000
  },

  h4: {
    interval: "4h",
    ms: 4 * 60 * 60 * 1000
  }

};


/* ================================================================
   HELPERS
================================================================ */

function clamp(
  value,
  min,
  max
) {

  return Math.max(
    min,
    Math.min(
      max,
      value
    )
  );

}


function round(
  value,
  decimals = 2
) {

  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(
      Number(value)
    )
  ) {
    return null;
  }


  const p =
    10 ** decimals;


  return (
    Math.round(
      Number(value) * p
    ) / p
  );

}


function first(value) {

  return Array.isArray(value)
    ? value[0]
    : value;

}


function numberParam(
  value,
  fallback,
  min,
  max
) {

  const n =
    Number(
      first(value)
    );


  if (
    !Number.isFinite(n)
  ) {
    return fallback;
  }


  return clamp(
    n,
    min,
    max
  );

}


function integerParam(
  value,
  fallback,
  min,
  max
) {

  return Math.round(
    numberParam(
      value,
      fallback,
      min,
      max
    )
  );

}


function boolParam(
  value,
  fallback
) {

  const raw =
    first(value);


  if (
    raw === undefined ||
    raw === null
  ) {

    return fallback;

  }


  return String(raw) ===
    "true";

}


/* ================================================================
   DATETIME
================================================================ */

function parseDate(value) {

  if (!value) {
    return null;
  }


  const normalized =
    value.includes("T")
      ? value
      : value.replace(
          " ",
          "T"
        );


  const ts =
    Date.parse(
      normalized.endsWith("Z")
        ? normalized
        : `${normalized}Z`
    );


  return Number.isFinite(ts)
    ? ts
    : null;

}


/* ================================================================
   EMA
================================================================ */

function ema(
  values,
  length
) {

  const output =
    new Array(
      values.length
    ).fill(null);


  if (
    values.length <
    length
  ) {
    return output;
  }


  let seed = 0;


  for (
    let i = 0;
    i < length;
    i++
  ) {

    seed +=
      values[i];

  }


  seed /=
    length;


  output[
    length - 1
  ] =
    seed;


  const k =
    2 /
    (
      length + 1
    );


  for (
    let i = length;
    i < values.length;
    i++
  ) {

    output[i] =
      (
        values[i] -
        output[
          i - 1
        ]
      ) *
        k +
      output[
        i - 1
      ];

  }


  return output;

}


/* ================================================================
   ATR
================================================================ */

function atr(
  candles,
  length = 14
) {

  const tr =
    new Array(
      candles.length
    ).fill(null);


  for (
    let i = 0;
    i < candles.length;
    i++
  ) {

    const candle =
      candles[i];


    if (
      i === 0
    ) {

      tr[i] =
        candle.high -
        candle.low;

      continue;

    }


    const previousClose =
      candles[
        i - 1
      ].close;


    tr[i] =
      Math.max(

        candle.high -
        candle.low,

        Math.abs(
          candle.high -
          previousClose
        ),

        Math.abs(
          candle.low -
          previousClose
        )

      );

  }


  const output =
    new Array(
      candles.length
    ).fill(null);


  if (
    candles.length <
    length
  ) {
    return output;
  }


  let seed = 0;


  for (
    let i = 0;
    i < length;
    i++
  ) {

    seed +=
      tr[i];

  }


  output[
    length - 1
  ] =
    seed /
    length;


  for (
    let i = length;
    i < candles.length;
    i++
  ) {

    output[i] =
      (
        output[
          i - 1
        ] *
          (
            length - 1
          ) +
        tr[i]
      ) /
      length;

  }


  return output;

}


/* ================================================================
   RSI
================================================================ */

function rsi(
  values,
  length = 14
) {

  const output =
    new Array(
      values.length
    ).fill(null);


  if (
    values.length <
    length + 1
  ) {
    return output;
  }


  let gains = 0;
  let losses = 0;


  for (
    let i = 1;
    i <= length;
    i++
  ) {

    const change =
      values[i] -
      values[
        i - 1
      ];


    if (
      change > 0
    ) {

      gains +=
        change;

    } else {

      losses +=
        Math.abs(
          change
        );

    }

  }


  let avgGain =
    gains / length;


  let avgLoss =
    losses / length;


  output[length] =
    avgLoss === 0
      ? 100
      : 100 -
        (
          100 /
          (
            1 +
            avgGain /
            avgLoss
          )
        );


  for (
    let i =
      length + 1;
    i <
      values.length;
    i++
  ) {

    const change =
      values[i] -
      values[
        i - 1
      ];


    const gain =
      change > 0
        ? change
        : 0;


    const loss =
      change < 0
        ? Math.abs(
            change
          )
        : 0;


    avgGain =
      (
        avgGain *
          (
            length - 1
          ) +
        gain
      ) /
      length;


    avgLoss =
      (
        avgLoss *
          (
            length - 1
          ) +
        loss
      ) /
      length;


    output[i] =
      avgLoss === 0
        ? 100
        : 100 -
          (
            100 /
            (
              1 +
              avgGain /
              avgLoss
            )
          );

  }


  return output;

}


/* ================================================================
   ADX
================================================================ */

function adx(
  candles,
  length = 14
) {

  const count =
    candles.length;


  const output =
    new Array(count)
      .fill(null);


  const tr =
    new Array(count)
      .fill(0);


  const plusDM =
    new Array(count)
      .fill(0);


  const minusDM =
    new Array(count)
      .fill(0);


  for (
    let i = 1;
    i < count;
    i++
  ) {

    const current =
      candles[i];


    const previous =
      candles[
        i - 1
      ];


    const upMove =
      current.high -
      previous.high;


    const downMove =
      previous.low -
      current.low;


    plusDM[i] =
      (
        upMove >
          downMove &&
        upMove > 0
      )
        ? upMove
        : 0;


    minusDM[i] =
      (
        downMove >
          upMove &&
        downMove > 0
      )
        ? downMove
        : 0;


    tr[i] =
      Math.max(

        current.high -
        current.low,

        Math.abs(
          current.high -
          previous.close
        ),

        Math.abs(
          current.low -
          previous.close
        )

      );

  }


  if (
    count <
    length * 2 + 2
  ) {
    return output;
  }


  let smoothTR = 0;
  let smoothPlus = 0;
  let smoothMinus = 0;


  for (
    let i = 1;
    i <= length;
    i++
  ) {

    smoothTR += tr[i];

    smoothPlus +=
      plusDM[i];

    smoothMinus +=
      minusDM[i];

  }


  const dx =
    new Array(count)
      .fill(null);


  for (
    let i = length;
    i < count;
    i++
  ) {

    if (
      i > length
    ) {

      smoothTR =
        smoothTR -
        smoothTR /
          length +
        tr[i];


      smoothPlus =
        smoothPlus -
        smoothPlus /
          length +
        plusDM[i];


      smoothMinus =
        smoothMinus -
        smoothMinus /
          length +
        minusDM[i];

    }


    if (
      smoothTR <= 0
    ) {
      continue;
    }


    const plusDI =
      100 *
      smoothPlus /
      smoothTR;


    const minusDI =
      100 *
      smoothMinus /
      smoothTR;


    const total =
      plusDI +
      minusDI;


    dx[i] =
      total === 0
        ? 0
        : (
            100 *
            Math.abs(
              plusDI -
              minusDI
            ) /
            total
          );

  }


  let seedCount = 0;
  let seed = 0;


  for (
    let i = length;
    i < count;
    i++
  ) {

    if (
      dx[i] === null
    ) {
      continue;
    }


    if (
      seedCount <
      length
    ) {

      seed +=
        dx[i];

      seedCount++;


      if (
        seedCount ===
        length
      ) {

        output[i] =
          seed /
          length;

      }


      continue;

    }


    output[i] =
      (
        output[
          i - 1
        ] *
          (
            length - 1
          ) +
        dx[i]
      ) /
      length;

  }


  return output;

}


/* ================================================================
   FETCH
================================================================ */

async function fetchSeries(
  timeframe,
  outputsize
) {

  const config =
    TF[timeframe];


  const url =
    new URL(
      TD_BASE
    );


  url.searchParams.set(
    "symbol",
    SYMBOL
  );


  url.searchParams.set(
    "interval",
    config.interval
  );


  url.searchParams.set(
    "outputsize",
    String(outputsize)
  );


  url.searchParams.set(
    "apikey",
    TD_KEY
  );


  url.searchParams.set(
    "timezone",
    "UTC"
  );


  url.searchParams.set(
    "format",
    "JSON"
  );


  const response =
    await fetch(
      url.toString(),
      {
        cache:
          "no-store"
      }
    );


  const json =
    await response.json();


  if (
    !response.ok ||
    json?.status === "error"
  ) {

    throw new Error(
      json?.message ||
      `${timeframe} request failed`
    );

  }


  if (
    !Array.isArray(
      json?.values
    )
  ) {

    throw new Error(
      `No ${timeframe} data returned`
    );

  }


  const now =
    Date.now();


  const data =
    json.values

      .map(
        row => {

          const ts =
            parseDate(
              row.datetime
            );


          const open =
            Number(
              row.open
            );


          const high =
            Number(
              row.high
            );


          const low =
            Number(
              row.low
            );


          const close =
            Number(
              row.close
            );


          if (
            !Number.isFinite(ts) ||
            !Number.isFinite(open) ||
            !Number.isFinite(high) ||
            !Number.isFinite(low) ||
            !Number.isFinite(close)
          ) {

            return null;

          }


          return {

            ts,

            closeTs:
              ts +
              config.ms,

            open,
            high,
            low,
            close

          };

        }
      )

      .filter(Boolean)

      .filter(
        candle =>
          candle.closeTs <=
          now - 1000
      )

      .sort(
        (
          a,
          b
        ) =>
          a.ts -
          b.ts
      );


  const unique = [];

  let lastTs =
    null;


  for (
    const candle of data
  ) {

    if (
      candle.ts ===
      lastTs
    ) {
      continue;
    }


    unique.push(
      candle
    );


    lastTs =
      candle.ts;

  }


  return unique;

}


/* ================================================================
   DECORATE
================================================================ */

function decorate(
  candles
) {

  const closes =
    candles.map(
      candle =>
        candle.close
    );


  const ema20 =
    ema(
      closes,
      20
    );


  const ema50 =
    ema(
      closes,
      50
    );


  const ema200 =
    ema(
      closes,
      200
    );


  const atr14 =
    atr(
      candles,
      14
    );


  const rsi14 =
    rsi(
      closes,
      14
    );


  const adx14 =
    adx(
      candles,
      14
    );


  return candles.map(
    (
      candle,
      index
    ) => {

      const slope20 =
        index > 0 &&
        Number.isFinite(
          ema20[index]
        ) &&
        Number.isFinite(
          ema20[
            index - 1
          ]
        )
          ? (
              ema20[index] -
              ema20[
                index - 1
              ]
            )
          : null;


      const slope50 =
        index > 0 &&
        Number.isFinite(
          ema50[index]
        ) &&
        Number.isFinite(
          ema50[
            index - 1
          ]
        )
          ? (
              ema50[index] -
              ema50[
                index - 1
              ]
            )
          : null;


      return {

        ...candle,

        ema20:
          ema20[index],

        ema50:
          ema50[index],

        ema200:
          ema200[index],

        atr14:
          atr14[index],

        rsi14:
          rsi14[index],

        adx14:
          adx14[index],

        slope20,

        slope50

      };

    }
  );

}


/* ================================================================
   COMPLETED HTF BAR
================================================================ */

function completedIndex(
  candles,
  timestamp
) {

  let left = 0;

  let right =
    candles.length - 1;

  let answer = -1;


  while (
    left <= right
  ) {

    const mid =
      Math.floor(
        (
          left +
          right
        ) /
        2
      );


    if (
      candles[mid]
        .closeTs <=
      timestamp
    ) {

      answer =
        mid;

      left =
        mid + 1;

    } else {

      right =
        mid - 1;

    }

  }


  return answer;

}


/* ================================================================
   MTF CONTEXT
================================================================ */

function getContext(
  data,
  m5Index
) {

  const m5 =
    data.m5[
      m5Index
    ];


  if (!m5) {
    return null;
  }


  const time =
    m5.closeTs;


  const m15Index =
    completedIndex(
      data.m15,
      time
    );


  const h1Index =
    completedIndex(
      data.h1,
      time
    );


  const h4Index =
    completedIndex(
      data.h4,
      time
    );


  if (
    m15Index < 0 ||
    h1Index < 0 ||
    h4Index < 0
  ) {

    return null;

  }


  return {

    m5,

    m15:
      data.m15[
        m15Index
      ],

    h1:
      data.h1[
        h1Index
      ],

    h4:
      data.h4[
        h4Index
      ]

  };

}


/* ================================================================
   TREND CONDITIONS
================================================================ */

function h4Bull(c) {

  return (
    c &&
    c.ema50 >
      c.ema200 &&
    c.close >
      c.ema50
  );

}


function h4Bear(c) {

  return (
    c &&
    c.ema50 <
      c.ema200 &&
    c.close <
      c.ema50
  );

}


function h1Bull(c) {

  return (
    c &&
    c.ema20 >
      c.ema50 &&
    c.ema50 >
      c.ema200 &&
    c.close >
      c.ema20
  );

}


function h1Bear(c) {

  return (
    c &&
    c.ema20 <
      c.ema50 &&
    c.ema50 <
      c.ema200 &&
    c.close <
      c.ema20
  );

}


function m15Bull(c) {

  return (
    c &&
    c.ema20 >
      c.ema50 &&
    c.close >
      c.ema20
  );

}


function m15Bear(c) {

  return (
    c &&
    c.ema20 <
      c.ema50 &&
    c.close <
      c.ema20
  );

}


function m5Bull(c) {

  return (
    c &&
    c.ema20 >
      c.ema50 &&
    c.close >
      c.ema20
  );

}


function m5Bear(c) {

  return (
    c &&
    c.ema20 <
      c.ema50 &&
    c.close <
      c.ema20
  );

}


/* ================================================================
   BODY RATIO
================================================================ */

function bodyRatio(candle) {

  const range =
    candle.high -
    candle.low;


  if (
    range <= 0
  ) {
    return 0;
  }


  return (
    Math.abs(
      candle.close -
      candle.open
    ) /
    range
  );

}


/* ================================================================
   SESSION
================================================================ */

function inSession(
  timestamp,
  startHour,
  endHour
) {

  const hour =
    new Date(
      timestamp
    ).getUTCHours();


  if (
    startHour <
    endHour
  ) {

    return (
      hour >=
        startHour &&
      hour <
        endHour
    );

  }


  return (
    hour >=
      startHour ||
    hour <
      endHour
  );

}


/* ================================================================
   PULLBACK
================================================================ */

function recentPullback(
  candles,
  index,
  side,
  settings
) {

  const start =
    Math.max(
      0,
      index -
      settings.pullbackBars +
      1
    );


  for (
    let i = start;
    i <= index;
    i++
  ) {

    const candle =
      candles[i];


    if (
      !Number.isFinite(
        candle.atr14
      ) ||
      !Number.isFinite(
        candle.ema20
      ) ||
      !Number.isFinite(
        candle.ema50
      )
    ) {

      continue;

    }


    const tolerance =
      candle.atr14 *
      settings.pullbackToleranceATR;


    if (
      side === 1
    ) {

      const touch =
        candle.low <=
        candle.ema20 +
        tolerance;


      const depthOkay =
        candle.low >=
        candle.ema50 -
        candle.atr14 *
        settings.maxPullbackDepthATR;


      if (
        touch &&
        depthOkay
      ) {

        return true;

      }

    } else {

      const touch =
        candle.high >=
        candle.ema20 -
        tolerance;


      const depthOkay =
        candle.high <=
        candle.ema50 +
        candle.atr14 *
        settings.maxPullbackDepthATR;


      if (
        touch &&
        depthOkay
      ) {

        return true;

      }

    }

  }


  return false;

}


/* ================================================================
   SCORE
================================================================ */

function setupScore(
  context,
  side,
  settings
) {

  let score = 0;


  if (
    side === 1
      ? h4Bull(
          context.h4
        )
      : h4Bear(
          context.h4
        )
  ) {

    score +=
      25;

  }


  if (
    side === 1
      ? h1Bull(
          context.h1
        )
      : h1Bear(
          context.h1
        )
  ) {

    score +=
      25;

  }


  if (
    side === 1
      ? m15Bull(
          context.m15
        )
      : m15Bear(
          context.m15
        )
  ) {

    score +=
      20;

  }


  if (
    context.m15.adx14 >=
    settings.minADX
  ) {

    score +=
      10;

  }


  if (
    side === 1
      ? m5Bull(
          context.m5
        )
      : m5Bear(
          context.m5
        )
  ) {

    score +=
      10;

  }


  if (
    side === 1 &&
    context.h1.slope20 > 0 &&
    context.m15.slope20 > 0
  ) {

    score +=
      10;

  }


  if (
    side === -1 &&
    context.h1.slope20 < 0 &&
    context.m15.slope20 < 0
  ) {

    score +=
      10;

  }


  return score;

}


/* ================================================================
   CONTINUATION ENTRY
================================================================ */

function continuationPass(
  current,
  previous,
  side,
  settings
) {

  const body =
    bodyRatio(
      current
    );


  if (
    body <
    settings.minBody
  ) {

    return false;

  }


  if (
    side === 1
  ) {

    const strictBreak =
      current.close >
      previous.high;


    const strongContinuation =
      current.close >
        previous.close &&
      current.close >
        current.open &&
      current.close >
        current.ema20 &&
      body >=
        settings.strongBody;


    return (
      strictBreak ||
      strongContinuation
    );

  }


  const strictBreak =
    current.close <
    previous.low;


  const strongContinuation =
    current.close <
      previous.close &&
    current.close <
      current.open &&
    current.close <
      current.ema20 &&
    body >=
      settings.strongBody;


  return (
    strictBreak ||
    strongContinuation
  );

}


/* ================================================================
   SIGNAL
================================================================ */

function getSignal(
  data,
  index,
  settings
) {

  if (
    index < 10
  ) {
    return null;
  }


  const context =
    getContext(
      data,
      index
    );


  if (!context) {
    return null;
  }


  const current =
    context.m5;


  const previous =
    data.m5[
      index - 1
    ];


  if (
    !Number.isFinite(
      current.atr14
    ) ||
    !Number.isFinite(
      current.rsi14
    ) ||
    !Number.isFinite(
      context.m15.adx14
    )
  ) {

    return null;

  }


  if (
    settings.useSession &&
    !inSession(
      current.ts,
      settings.sessionStart,
      settings.sessionEnd
    )
  ) {

    return null;

  }


  const atrPct =
    (
      current.atr14 /
      current.close
    ) *
    100;


  if (
    atrPct <
    settings.minAtrPct
  ) {

    return null;

  }


  /* ============================================================
     LONG
  ============================================================ */

  if (
    h4Bull(
      context.h4
    ) &&
    h1Bull(
      context.h1
    ) &&
    m15Bull(
      context.m15
    )
  ) {

    const score =
      setupScore(
        context,
        1,
        settings
      );


    const pullback =
      recentPullback(
        data.m5,
        index,
        1,
        settings
      );


    const rsiOkay =
      current.rsi14 >=
        settings.longRsiMin &&
      current.rsi14 <=
        settings.longRsiMax;


    const continuation =
      continuationPass(
        current,
        previous,
        1,
        settings
      );


    const chase =
      Math.abs(
        current.close -
        current.ema20
      ) /
      current.atr14;


    if (
      score >=
        settings.minScore &&
      pullback &&
      rsiOkay &&
      continuation &&
      chase <=
        settings.maxChaseATR
    ) {

      return {

        side: 1,

        score

      };

    }

  }


  /* ============================================================
     SHORT
  ============================================================ */

  if (
    h4Bear(
      context.h4
    ) &&
    h1Bear(
      context.h1
    ) &&
    m15Bear(
      context.m15
    )
  ) {

    const score =
      setupScore(
        context,
        -1,
        settings
      );


    const pullback =
      recentPullback(
        data.m5,
        index,
        -1,
        settings
      );


    const rsiOkay =
      current.rsi14 >=
        settings.shortRsiMin &&
      current.rsi14 <=
        settings.shortRsiMax;


    const continuation =
      continuationPass(
        current,
        previous,
        -1,
        settings
      );


    const chase =
      Math.abs(
        current.close -
        current.ema20
      ) /
      current.atr14;


    if (
      score >=
        settings.minScore &&
      pullback &&
      rsiOkay &&
      continuation &&
      chase <=
        settings.maxChaseATR
    ) {

      return {

        side: -1,

        score

      };

    }

  }


  return null;

}


/* ================================================================
   STOP
================================================================ */

function calculateStop(
  candles,
  signalIndex,
  entry,
  side,
  settings
) {

  const signal =
    candles[
      signalIndex
    ];


  if (
    !Number.isFinite(
      signal.atr14
    )
  ) {
    return null;
  }


  const atrValue =
    signal.atr14;


  const start =
    Math.max(
      0,
      signalIndex -
      settings.swingLookback +
      1
    );


  if (
    side === 1
  ) {

    let swing =
      Infinity;


    for (
      let i = start;
      i <= signalIndex;
      i++
    ) {

      swing =
        Math.min(
          swing,
          candles[i].low
        );

    }


    let stop =
      swing -
      atrValue *
      settings.structureBufferATR;


    let distance =
      entry -
      stop;


    const minimum =
      atrValue *
      settings.minStopATR;


    const maximum =
      atrValue *
      settings.maxStopATR;


    if (
      distance <
      minimum
    ) {

      distance =
        minimum;

      stop =
        entry -
        distance;

    }


    if (
      distance >
      maximum
    ) {
      return null;
    }


    return {

      stop,
      distance

    };

  }


  let swing =
    -Infinity;


  for (
    let i = start;
    i <= signalIndex;
    i++
  ) {

    swing =
      Math.max(
        swing,
        candles[i].high
      );

  }


  let stop =
    swing +
    atrValue *
    settings.structureBufferATR;


  let distance =
    stop -
    entry;


  const minimum =
    atrValue *
    settings.minStopATR;


  const maximum =
    atrValue *
    settings.maxStopATR;


  if (
    distance <
    minimum
  ) {

    distance =
      minimum;

    stop =
      entry +
      distance;

  }


  if (
    distance >
    maximum
  ) {
    return null;
  }


  return {

    stop,
    distance

  };

}


/* ================================================================
   SIMULATION
================================================================ */

function simulateTrade(
  data,
  signalIndex,
  signal,
  settings
) {

  const entryIndex =
    signalIndex + 1;


  if (
    entryIndex >=
    data.m5.length
  ) {

    return null;

  }


  const entry =
    data.m5[
      entryIndex
    ].open;


  const stopInfo =
    calculateStop(

      data.m5,

      signalIndex,

      entry,

      signal.side,

      settings

    );


  if (!stopInfo) {
    return null;
  }


  const originalStop =
    stopInfo.stop;


  const riskDistance =
    stopInfo.distance;


  const target =
    signal.side === 1
      ? entry +
        riskDistance *
        settings.targetR
      : entry -
        riskDistance *
        settings.targetR;


  const beTrigger =
    signal.side === 1
      ? entry +
        riskDistance *
        settings.breakevenR
      : entry -
        riskDistance *
        settings.breakevenR;


  let activeStop =
    originalStop;


  let beActive =
    false;


  const maxIndex =
    Math.min(

      data.m5.length - 1,

      entryIndex +
      settings.maxHoldBars

    );


  let exitIndex =
    maxIndex;


  let exitPrice =
    data.m5[
      exitIndex
    ].close;


  let result =
    "TIME";


  let rawR =
    null;


  for (
    let i = entryIndex;
    i <= maxIndex;
    i++
  ) {

    const candle =
      data.m5[i];


    /* BUY */

    if (
      signal.side === 1
    ) {

      const stopHit =
        candle.low <=
        activeStop;


      const targetHit =
        candle.high >=
        target;


      if (
        stopHit
      ) {

        exitIndex =
          i;

        exitPrice =
          activeStop;

        rawR =
          beActive
            ? 0
            : -1;

        result =
          beActive
            ? "BE"
            : "SL";

        break;

      }


      if (
        targetHit
      ) {

        exitIndex =
          i;

        exitPrice =
          target;

        rawR =
          settings.targetR;

        result =
          "TP";

        break;

      }


      if (
        settings.useBreakeven &&
        !beActive &&
        candle.high >=
          beTrigger
      ) {

        beActive =
          true;

        activeStop =
          entry;

      }

    }


    /* SELL */

    else {

      const stopHit =
        candle.high >=
        activeStop;


      const targetHit =
        candle.low <=
        target;


      if (
        stopHit
      ) {

        exitIndex =
          i;

        exitPrice =
          activeStop;

        rawR =
          beActive
            ? 0
            : -1;

        result =
          beActive
            ? "BE"
            : "SL";

        break;

      }


      if (
        targetHit
      ) {

        exitIndex =
          i;

        exitPrice =
          target;

        rawR =
          settings.targetR;

        result =
          "TP";

        break;

      }


      if (
        settings.useBreakeven &&
        !beActive &&
        candle.low <=
          beTrigger
      ) {

        beActive =
          true;

        activeStop =
          entry;

      }

    }

  }


  if (
    rawR === null
  ) {

    rawR =
      signal.side === 1
        ? (
            exitPrice -
            entry
          ) /
          riskDistance
        : (
            entry -
            exitPrice
          ) /
          riskDistance;

  }


  const netR =
    rawR -
    settings.costR;


  return {

    side:
      signal.side === 1
        ? "BUY"
        : "SELL",

    score:
      signal.score,

    signalIndex,

    entryIndex,

    exitIndex,

    signalTime:
      new Date(
        data.m5[
          signalIndex
        ].closeTs
      ).toISOString(),

    entryTime:
      new Date(
        data.m5[
          entryIndex
        ].ts
      ).toISOString(),

    exitTime:
      new Date(
        data.m5[
          exitIndex
        ].closeTs
      ).toISOString(),

    entry:
      round(
        entry,
        4
      ),

    stopLoss:
      round(
        originalStop,
        4
      ),

    target:
      round(
        target,
        4
      ),

    exit:
      round(
        exitPrice,
        4
      ),

    rawR:
      round(
        rawR,
        4
      ),

    netR:
      round(
        netR,
        4
      ),

    result,

    holdBars:
      exitIndex -
      entryIndex +
      1

  };

}


/* ================================================================
   METRICS
================================================================ */

function metrics(
  trades,
  settings
) {

  let wins = 0;

  let losses = 0;

  let breakevens = 0;

  let buys = 0;

  let sells = 0;

  let grossWinR = 0;

  let grossLossR = 0;

  let totalR = 0;


  let equity =
    settings.initialBalance;


  let peak =
    equity;


  let maxDrawdown =
    0;


  const equityCurve = [

    {
      trade: 0,

      equity:
        round(
          equity,
          2
        )
    }

  ];


  for (
    let i = 0;
    i < trades.length;
    i++
  ) {

    const trade =
      trades[i];


    const r =
      trade.netR;


    totalR +=
      r;


    if (
      trade.side ===
      "BUY"
    ) {

      buys++;

    } else {

      sells++;

    }


    if (
      r > 0
    ) {

      wins++;

      grossWinR +=
        r;

    } else if (
      r < 0
    ) {

      losses++;

      grossLossR +=
        Math.abs(r);

    } else {

      breakevens++;

    }


    equity *=
      1 +
      (
        r *
        settings.riskPct /
        100
      );


    peak =
      Math.max(
        peak,
        equity
      );


    const dd =
      (
        (
          peak -
          equity
        ) /
        peak
      ) *
      100;


    maxDrawdown =
      Math.max(
        maxDrawdown,
        dd
      );


    equityCurve.push({

      trade:
        i + 1,

      equity:
        round(
          equity,
          2
        )

    });

  }


  const count =
    trades.length;


  const winRate =
    count
      ? wins /
        count *
        100
      : 0;


  const pf =
    grossLossR > 0
      ? grossWinR /
        grossLossR
      : grossWinR > 0
        ? 99
        : 0;


  const expectancy =
    count
      ? totalR /
        count
      : 0;


  const returnPct =
    (
      (
        equity -
        settings.initialBalance
      ) /
      settings.initialBalance
    ) *
    100;


  return {

    trades:
      count,

    wins,

    losses,

    breakevens,

    buys,

    sells,

    winRate:
      round(
        winRate,
        2
      ),

    profitFactor:
      round(
        pf,
        2
      ),

    expectancyR:
      round(
        expectancy,
        4
      ),

    totalR:
      round(
        totalR,
        2
      ),

    maxDrawdown:
      round(
        maxDrawdown,
        2
      ),

    initialBalance:
      round(
        settings.initialBalance,
        2
      ),

    finalBalance:
      round(
        equity,
        2
      ),

    returnPct:
      round(
        returnPct,
        2
      ),

    equityCurve

  };

}


/* ================================================================
   GRADE
================================================================ */

function grade(
  all,
  validation
) {

  if (
    all.trades <
    20
  ) {

    return {

      grade:
        "N/A",

      verdict:
        "Sample still too small"

    };

  }


  if (
    all.trades >= 40 &&
    all.profitFactor >=
      1.4 &&
    all.expectancyR >=
      0.15 &&
    all.maxDrawdown <=
      12 &&
    validation.trades >=
      8 &&
    validation.profitFactor >=
      1.10 &&
    validation.expectancyR >
      0
  ) {

    return {

      grade:
        "A",

      verdict:
        "Strong historical result"

    };

  }


  if (
    all.trades >= 25 &&
    all.profitFactor >=
      1.2 &&
    all.expectancyR >=
      0.08 &&
    validation.expectancyR >=
      0
  ) {

    return {

      grade:
        "B",

      verdict:
        "Promising historical edge"

    };

  }


  if (
    all.profitFactor >
      1.05 &&
    all.expectancyR >
      0
  ) {

    return {

      grade:
        "C",

      verdict:
        "Positive but not yet robust"

    };

  }


  return {

    grade:
      "D",

    verdict:
      "Weak historical result"

  };

}


/* ================================================================
   RUN MODE
================================================================ */

function runMode(
  data,
  settings
) {

  const startIndex =
    Math.max(
      220,
      data.m5.length -
      settings.testBars
    );


  const trades = [];


  let i =
    startIndex;


  while (
    i <
    data.m5.length - 1
  ) {

    const signal =
      getSignal(
        data,
        i,
        settings
      );


    if (!signal) {

      i++;

      continue;

    }


    const trade =
      simulateTrade(
        data,
        i,
        signal,
        settings
      );


    if (!trade) {

      i++;

      continue;

    }


    trades.push(
      trade
    );


    i =
      trade.exitIndex +
      settings.cooldownBars +
      1;

  }


  const startTime =
    data.m5[
      startIndex
    ].ts;


  const endTime =
    data.m5[
      data.m5.length -
      1
    ].closeTs;


  const split =
    startTime +
    (
      endTime -
      startTime
    ) *
    0.70;


  const developmentTrades =
    trades.filter(
      trade =>
        Date.parse(
          trade.entryTime
        ) <
        split
    );


  const validationTrades =
    trades.filter(
      trade =>
        Date.parse(
          trade.entryTime
        ) >=
        split
    );


  const all =
    metrics(
      trades,
      settings
    );


  const development =
    metrics(
      developmentTrades,
      settings
    );


  const validation =
    metrics(
      validationTrades,
      settings
    );


  const resultGrade =
    grade(
      all,
      validation
    );


  return {

    mode:
      settings.mode,

    metrics: {

      ...all,

      grade:
        resultGrade.grade,

      verdict:
        resultGrade.verdict

    },

    development,

    validation,

    splitTime:
      new Date(split)
        .toISOString(),

    trades

  };

}


/* ================================================================
   PRESETS
================================================================ */

function presets(
  base
) {

  return [


    /* ============================================================
       STRICT
    ============================================================ */

    {

      ...base,

      mode:
        "STRICT",

      minScore:
        80,

      minADX:
        18,

      pullbackBars:
        5,

      pullbackToleranceATR:
        0.18,

      maxPullbackDepthATR:
        0.50,

      minBody:
        0.45,

      strongBody:
        0.55,

      maxChaseATR:
        0.75,

      longRsiMin:
        48,

      longRsiMax:
        68,

      shortRsiMin:
        32,

      shortRsiMax:
        52,

      cooldownBars:
        3

    },


    /* ============================================================
       BALANCED
    ============================================================ */

    {

      ...base,

      mode:
        "BALANCED",

      minScore:
        68,

      minADX:
        14,

      pullbackBars:
        8,

      pullbackToleranceATR:
        0.28,

      maxPullbackDepthATR:
        0.75,

      minBody:
        0.30,

      strongBody:
        0.42,

      maxChaseATR:
        1.10,

      longRsiMin:
        44,

      longRsiMax:
        72,

      shortRsiMin:
        28,

      shortRsiMax:
        56,

      cooldownBars:
        1

    },


    /* ============================================================
       ACTIVE
    ============================================================ */

    {

      ...base,

      mode:
        "ACTIVE",

      minScore:
        60,

      minADX:
        12,

      pullbackBars:
        10,

      pullbackToleranceATR:
        0.35,

      maxPullbackDepthATR:
        0.95,

      minBody:
        0.22,

      strongBody:
        0.34,

      maxChaseATR:
        1.35,

      longRsiMin:
        40,

      longRsiMax:
        76,

      shortRsiMin:
        24,

      shortRsiMax:
        60,

      cooldownBars:
        0

    }

  ];

}


/* ================================================================
   LATEST MARKET
================================================================ */

function latestState(
  data
) {

  const index =
    data.m5.length - 1;


  const context =
    getContext(
      data,
      index
    );


  if (!context) {
    return null;
  }


  let bias =
    "NEUTRAL";


  if (
    h4Bull(
      context.h4
    ) &&
    h1Bull(
      context.h1
    )
  ) {

    bias =
      "BULLISH";

  }


  if (
    h4Bear(
      context.h4
    ) &&
    h1Bear(
      context.h1
    )
  ) {

    bias =
      "BEARISH";

  }


  const state =
    (
      candle,
      type
    ) => {

      let direction =
        "MIXED";


      if (
        type ===
        "H4"
      ) {

        if (
          h4Bull(candle)
        ) {
          direction =
            "BULLISH";
        }


        if (
          h4Bear(candle)
        ) {
          direction =
            "BEARISH";
        }

      }


      if (
        type ===
        "H1"
      ) {

        if (
          h1Bull(candle)
        ) {
          direction =
            "BULLISH";
        }


        if (
          h1Bear(candle)
        ) {
          direction =
            "BEARISH";
        }

      }


      if (
        type ===
        "M15"
      ) {

        if (
          m15Bull(candle)
        ) {
          direction =
            "BULLISH";
        }


        if (
          m15Bear(candle)
        ) {
          direction =
            "BEARISH";
        }

      }


      if (
        type ===
        "M5"
      ) {

        if (
          m5Bull(candle)
        ) {
          direction =
            "BULLISH";
        }


        if (
          m5Bear(candle)
        ) {
          direction =
            "BEARISH";
        }

      }


      return {

        direction,

        price:
          round(
            candle.close,
            2
          ),

        ema20:
          round(
            candle.ema20,
            2
          ),

        ema50:
          round(
            candle.ema50,
            2
          ),

        ema200:
          round(
            candle.ema200,
            2
          ),

        rsi:
          round(
            candle.rsi14,
            1
          ),

        adx:
          round(
            candle.adx14,
            1
          )

      };

    };


  return {

    time:
      new Date(
        context.m5.closeTs
      ).toISOString(),

    bias,

    timeframes: {

      m5:
        state(
          context.m5,
          "M5"
        ),

      m15:
        state(
          context.m15,
          "M15"
        ),

      h1:
        state(
          context.h1,
          "H1"
        ),

      h4:
        state(
          context.h4,
          "H4"
        )

    }

  };

}


/* ================================================================
   CACHE
================================================================ */

let CACHE = {

  key: null,

  expires: 0,

  data: null

};


/* ================================================================
   LOAD DATA
================================================================ */

async function loadData(
  testBars
) {

  const m5Size =
    Math.min(
      5000,
      testBars + 300
    );


  const m15Size =
    Math.min(
      5000,
      Math.ceil(
        m5Size / 3
      ) +
      300
    );


  const h1Size =
    Math.min(
      5000,
      Math.ceil(
        m5Size / 12
      ) +
      300
    );


  const h4Size =
    Math.max(
      450,
      Math.ceil(
        m5Size / 48
      ) +
      300
    );


  const key =
    [
      m5Size,
      m15Size,
      h1Size,
      h4Size
    ].join("-");


  if (
    CACHE.key ===
      key &&
    CACHE.expires >
      Date.now() &&
    CACHE.data
  ) {

    return CACHE.data;

  }


  const [
    m5,
    m15,
    h1,
    h4
  ] =
    await Promise.all([

      fetchSeries(
        "m5",
        m5Size
      ),

      fetchSeries(
        "m15",
        m15Size
      ),

      fetchSeries(
        "h1",
        h1Size
      ),

      fetchSeries(
        "h4",
        h4Size
      )

    ]);


  const data = {

    m5:
      decorate(m5),

    m15:
      decorate(m15),

    h1:
      decorate(h1),

    h4:
      decorate(h4)

  };


  CACHE = {

    key,

    expires:
      Date.now() +
      45000,

    data

  };


  return data;

}


/* ================================================================
   HANDLER
================================================================ */

export default async function handler(
  req,
  res
) {

  res.setHeader(
    "Cache-Control",
    "no-store, max-age=0"
  );


  if (
    req.method !==
    "GET"
  ) {

    return res
      .status(405)
      .json({

        ok: false,

        error:
          "GET only"

      });

  }


  if (!TD_KEY) {

    return res
      .status(500)
      .json({

        ok: false,

        error:
          "Missing TWELVE_DATA_API_KEY_4"

      });

  }


  try {

    const q =
      req.query || {};


    const base = {

      testBars:
        integerParam(
          q.bars,
          4500,
          1000,
          4700
        ),


      targetR:
        numberParam(
          q.targetR,
          1.8,
          0.5,
          6
        ),


      useBreakeven:
        boolParam(
          q.useBreakeven,
          true
        ),


      breakevenR:
        numberParam(
          q.breakevenR,
          1.0,
          0.25,
          4
        ),


      swingLookback:
        integerParam(
          q.swingLookback,
          6,
          2,
          30
        ),


      structureBufferATR:
        numberParam(
          q.structureBufferATR,
          0.15,
          0,
          2
        ),


      minStopATR:
        numberParam(
          q.minStopATR,
          0.80,
          0.2,
          5
        ),


      maxStopATR:
        numberParam(
          q.maxStopATR,
          2.0,
          0.5,
          8
        ),


      maxHoldBars:
        integerParam(
          q.maxHoldBars,
          48,
          5,
          300
        ),


      minAtrPct:
        numberParam(
          q.minAtrPct,
          0.015,
          0,
          2
        ),


      useSession:
        boolParam(
          q.useSession,
          true
        ),


      sessionStart:
        integerParam(
          q.sessionStart,
          5,
          0,
          23
        ),


      sessionEnd:
        integerParam(
          q.sessionEnd,
          19,
          0,
          23
        ),


      initialBalance:
        numberParam(
          q.initialBalance,
          10000,
          100,
          100000000
        ),


      riskPct:
        numberParam(
          q.riskPct,
          0.5,
          0.01,
          10
        ),


      costR:
        numberParam(
          q.costR,
          0.04,
          0,
          0.5
        )

    };


    const data =
      await loadData(
        base.testBars
      );


    const modeResults = [];


    for (
      const settings of
      presets(base)
    ) {

      modeResults.push(
        runMode(
          data,
          settings
        )
      );

    }


    /*
     * Rank primarily by robustness,
     * not only raw total R.
     */

    modeResults.sort(
      (
        a,
        b
      ) => {

        const scoreA =
          (
            a.validation
              .expectancyR *
              30
          ) +
          (
            Math.min(
              a.metrics
                .profitFactor,
              4
            ) *
              8
          ) +
          (
            Math.min(
              a.metrics.trades,
              60
            ) *
              0.25
          ) -
          (
            a.metrics
              .maxDrawdown *
              1.5
          );


        const scoreB =
          (
            b.validation
              .expectancyR *
              30
          ) +
          (
            Math.min(
              b.metrics
                .profitFactor,
              4
            ) *
              8
          ) +
          (
            Math.min(
              b.metrics.trades,
              60
            ) *
              0.25
          ) -
          (
            b.metrics
              .maxDrawdown *
              1.5
          );


        return (
          scoreB -
          scoreA
        );

      }
    );


    const best =
      modeResults[0];


    const startIndex =
      Math.max(
        220,
        data.m5.length -
        base.testBars
      );


    return res
      .status(200)
      .json({

        ok: true,

        strategy:
          "TYSON TREND PULLBACK V1.2",

        symbol:
          SYMBOL,

        latest:
          latestState(data),

        period: {

          start:
            new Date(
              data.m5[
                startIndex
              ].ts
            ).toISOString(),

          end:
            new Date(
              data.m5[
                data.m5.length -
                1
              ].closeTs
            ).toISOString()

        },

        bestMode:
          best.mode,

        best,

        modes:
          modeResults.map(
            result => ({

              mode:
                result.mode,

              metrics:
                result.metrics,

              development:
                result.development,

              validation:
                result.validation,

              splitTime:
                result.splitTime

            })
          ),

        trades:
          best.trades
            .slice(-300)
            .reverse(),

        assumptions: [

          "No unfinished M5 candle is used.",

          "Higher-timeframe candles are unavailable until completed.",

          "Entry occurs on the next M5 open.",

          "Stop has priority if stop and target are reachable in the same bar.",

          "Breakeven activates only for following candles.",

          "The engine compares strict, balanced and active rule sets.",

          "Backtest results are not guarantees of future profitability."

        ]

      });


  } catch (
    error
  ) {

    console.error(error);


    return res
      .status(500)
      .json({

        ok: false,

        error:
          error?.message ||
          "Backtest failed"

      });

  }

}