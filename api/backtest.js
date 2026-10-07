/* ================================================================
   TYSON TRADE AI
   REGIME PULLBACK V1.4
   ---------------------------------------------------------------
   /api/backtest.js

   MARKET
   ------
   XAU/USD

   DATA
   ----
   Twelve Data M5

   HIGHER TIMEFRAMES
   -----------------
   M15 / H1 / H4 are built locally from M5.

   ENVIRONMENT
   -----------
   TWELVE_DATA_API_KEY_4

   FALLBACK
   --------
   TWELVE_DATA_API_KEY

   CORE IDEA
   ---------
   H4 = macro EMA regime
   H1 = primary trend + regime strength
   M15 = local trend + acceleration
   M5 = pullback + continuation trigger

   INDICATORS
   ----------
   EMA20
   EMA50
   EMA200
   RSI14
   ATR14
   ADX14

   V1.4 IMPROVEMENTS
   -----------------
   - Extended history
   - Development-only model selection
   - Hard positive-edge requirement
   - Regime-quality filtering
   - EMA separation normalized by ATR
   - H1 + M15 ADX filtering
   - ADX acceleration filtering
   - BUY / SELL breakdown
   - 4 chronological stability windows
   - Untouched 30% validation
   - No deployment when development edge is negative
   - Actual target R explicitly returned

   ENTRY
   -----
   Signal is evaluated on completed M5 candle.
   Trade enters NEXT M5 open.

   SAME BAR COLLISION
   ------------------
   SL first.

   IMPORTANT
   ---------
   Historical results do not guarantee future performance.
================================================================ */


/* ================================================================
   GLOBAL CONFIG
================================================================ */

const TD_KEY =
  process.env.TWELVE_DATA_API_KEY_4 ||
  process.env.TWELVE_DATA_API_KEY;


const TD_BASE =
  "https://api.twelvedata.com/time_series";


const SYMBOL =
  "XAU/USD";


const M5_MS =
  5 * 60 * 1000;


const TF_MS = {

  m15:
    15 * 60 * 1000,

  h1:
    60 * 60 * 1000,

  h4:
    4 * 60 * 60 * 1000

};


/*
 * Twelve Data normally allows a maximum
 * output size around this region.
 */

const CHUNK_SIZE =
  5000;


/*
 * 8 x 5000 gives enough room for:
 *
 * evaluation history
 * +
 * H4 EMA200 warm-up.
 */

const MAX_CHUNKS =
  8;


/*
 * H4 EMA200:
 *
 * 200 H4 candles
 * x 48 M5 candles
 * = 9600 M5 bars.
 *
 * Add safety margin.
 */

const WARMUP_M5_BARS =
  10500;


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


  const factor =
    10 ** decimals;


  return (
    Math.round(
      Number(value) *
      factor
    ) /
    factor
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

  const raw =
    first(value);


  /*
   * Important:
   * Number("") = 0 in JS.
   *
   * We do NOT want blank form fields
   * silently becoming zero.
   */

  if (
    raw === undefined ||
    raw === null ||
    raw === ""
  ) {

    return fallback;

  }


  const n =
    Number(raw);


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
    raw === null ||
    raw === ""
  ) {

    return fallback;

  }


  return (
    String(raw) ===
    "true"
  );

}


/* ================================================================
   DATE
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


  const timestamp =
    Date.parse(

      normalized.endsWith("Z")
        ? normalized
        : `${normalized}Z`

    );


  return Number.isFinite(timestamp)
    ? timestamp
    : null;

}


function twelveDate(
  timestamp
) {

  return new Date(
    timestamp
  )
    .toISOString()
    .slice(
      0,
      19
    )
    .replace(
      "T",
      " "
    );

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


  const multiplier =
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
        multiplier +
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


  let averageGain =
    gains /
    length;


  let averageLoss =
    losses /
    length;


  output[length] =
    averageLoss === 0
      ? 100
      : 100 -
        (
          100 /
          (
            1 +
            averageGain /
            averageLoss
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


    averageGain =
      (
        averageGain *
          (
            length - 1
          ) +
        gain
      ) /
      length;


    averageLoss =
      (
        averageLoss *
          (
            length - 1
          ) +
        loss
      ) /
      length;


    output[i] =
      averageLoss === 0
        ? 100
        : 100 -
          (
            100 /
            (
              1 +
              averageGain /
              averageLoss
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

  const size =
    candles.length;


  const output =
    new Array(
      size
    ).fill(null);


  if (
    size <
    length * 2 + 2
  ) {

    return output;

  }


  const tr =
    new Array(size)
      .fill(0);


  const plusDM =
    new Array(size)
      .fill(0);


  const minusDM =
    new Array(size)
      .fill(0);


  for (
    let i = 1;
    i < size;
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


  let smoothTR = 0;

  let smoothPlus = 0;

  let smoothMinus = 0;


  for (
    let i = 1;
    i <= length;
    i++
  ) {

    smoothTR +=
      tr[i];

    smoothPlus +=
      plusDM[i];

    smoothMinus +=
      minusDM[i];

  }


  const dx =
    new Array(size)
      .fill(null);


  for (
    let i = length;
    i < size;
    i++
  ) {

    if (
      i >
      length
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


  let seed = 0;

  let seedCount = 0;


  for (
    let i = length;
    i < size;
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
   FETCH M5 PAGE
================================================================ */

async function fetchM5Page(
  outputsize,
  endDate = null
) {

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
    "5min"
  );


  url.searchParams.set(
    "outputsize",
    String(
      outputsize
    )
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


  if (
    endDate !== null
  ) {

    url.searchParams.set(
      "end_date",
      twelveDate(
        endDate
      )
    );

  }


  const response =
    await fetch(
      url.toString(),
      {
        cache:
          "no-store"
      }
    );


  let json;


  try {

    json =
      await response.json();

  } catch {

    throw new Error(
      "Twelve Data returned invalid JSON."
    );

  }


  if (
    !response.ok ||
    json?.status ===
      "error"
  ) {

    throw new Error(
      json?.message ||
      `Twelve Data HTTP ${response.status}`
    );

  }


  if (
    !Array.isArray(
      json?.values
    )
  ) {

    throw new Error(
      "No M5 candle data returned."
    );

  }


  const now =
    Date.now();


  return json.values

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
            M5_MS,

          open,

          high,

          low,

          close

        };

      }
    )

    .filter(Boolean)

    /*
     * Remove incomplete live candle.
     */

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

}


/* ================================================================
   FETCH EXTENDED HISTORY
================================================================ */

async function fetchM5History(
  targetBars
) {

  const all =
    [];


  let endDate =
    null;


  let previousOldest =
    null;


  for (
    let chunk = 0;
    chunk < MAX_CHUNKS;
    chunk++
  ) {

    const remaining =
      targetBars -
      all.length;


    if (
      remaining <= 0
    ) {

      break;

    }


    const outputsize =
      Math.min(

        CHUNK_SIZE,

        Math.max(
          500,
          remaining
        )

      );


    const page =
      await fetchM5Page(
        outputsize,
        endDate
      );


    if (
      !page.length
    ) {

      break;

    }


    all.push(
      ...page
    );


    const oldest =
      page[0].ts;


    if (
      previousOldest !== null &&
      oldest >=
        previousOldest
    ) {

      break;

    }


    previousOldest =
      oldest;


    endDate =
      oldest -
      1000;

  }


  /*
   * Deduplicate candles.
   */

  const map =
    new Map();


  for (
    const candle of
    all
  ) {

    map.set(
      candle.ts,
      candle
    );

  }


  const candles =
    Array.from(
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


  if (
    candles.length >
    targetBars
  ) {

    return candles.slice(
      candles.length -
      targetBars
    );

  }


  return candles;

}


/* ================================================================
   AGGREGATE HIGHER TIMEFRAME
================================================================ */

function aggregateCandles(
  source,
  timeframeMs
) {

  const buckets =
    new Map();


  for (
    const candle of
    source
  ) {

    const bucketTs =
      Math.floor(
        candle.ts /
        timeframeMs
      ) *
      timeframeMs;


    let bar =
      buckets.get(
        bucketTs
      );


    if (!bar) {

      bar = {

        ts:
          bucketTs,

        closeTs:
          bucketTs +
          timeframeMs,

        open:
          candle.open,

        high:
          candle.high,

        low:
          candle.low,

        close:
          candle.close,

        count:
          1

      };


      buckets.set(
        bucketTs,
        bar
      );


      continue;

    }


    bar.high =
      Math.max(
        bar.high,
        candle.high
      );


    bar.low =
      Math.min(
        bar.low,
        candle.low
      );


    bar.close =
      candle.close;


    bar.count++;

  }


  const result =
    Array.from(
      buckets.values()
    )
      .sort(
        (
          a,
          b
        ) =>
          a.ts -
          b.ts
      );


  /*
   * First aggregate candle may be partial
   * because historical download may start
   * midway through the HTF candle.
   */

  if (
    result.length >
    1
  ) {

    result.shift();

  }


  return result;

}


/* ================================================================
   DECORATE SERIES
================================================================ */

function decorate(
  candles
) {

  const closes =
    candles.map(
      candle =>
        candle.close
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


  const a14 =
    atr(
      candles,
      14
    );


  const r14 =
    rsi(
      closes,
      14
    );


  const x14 =
    adx(
      candles,
      14
    );


  return candles.map(
    (
      candle,
      index
    ) => {

      const atrValue =
        a14[index];


      const slope20 =
        index > 0 &&
        Number.isFinite(
          e20[index]
        ) &&
        Number.isFinite(
          e20[
            index - 1
          ]
        )
          ? (
              e20[index] -
              e20[
                index - 1
              ]
            )
          : null;


      const slope50 =
        index > 0 &&
        Number.isFinite(
          e50[index]
        ) &&
        Number.isFinite(
          e50[
            index - 1
          ]
        )
          ? (
              e50[index] -
              e50[
                index - 1
              ]
            )
          : null;


      const adxDelta =
        index > 0 &&
        Number.isFinite(
          x14[index]
        ) &&
        Number.isFinite(
          x14[
            index - 1
          ]
        )
          ? (
              x14[index] -
              x14[
                index - 1
              ]
            )
          : null;


      const gap2050ATR =
        Number.isFinite(
          atrValue
        ) &&
        atrValue > 0 &&
        Number.isFinite(
          e20[index]
        ) &&
        Number.isFinite(
          e50[index]
        )
          ? (
              Math.abs(
                e20[index] -
                e50[index]
              ) /
              atrValue
            )
          : null;


      const gap50200ATR =
        Number.isFinite(
          atrValue
        ) &&
        atrValue > 0 &&
        Number.isFinite(
          e50[index]
        ) &&
        Number.isFinite(
          e200[index]
        )
          ? (
              Math.abs(
                e50[index] -
                e200[index]
              ) /
              atrValue
            )
          : null;


      return {

        ...candle,

        ema20:
          e20[index],

        ema50:
          e50[index],

        ema200:
          e200[index],

        atr14:
          a14[index],

        rsi14:
          r14[index],

        adx14:
          x14[index],

        slope20,

        slope50,

        adxDelta,

        gap2050ATR,

        gap50200ATR

      };

    }
  );

}


/* ================================================================
   BUILD DATA
================================================================ */

function buildData(
  m5
) {

  return {

    m5:
      decorate(
        m5
      ),

    m15:
      decorate(

        aggregateCandles(
          m5,
          TF_MS.m15
        )

      ),

    h1:
      decorate(

        aggregateCandles(
          m5,
          TF_MS.h1
        )

      ),

    h4:
      decorate(

        aggregateCandles(
          m5,
          TF_MS.h4
        )

      )

  };

}


/* ================================================================
   COMPLETED BAR INDEX
================================================================ */

function completedIndex(
  candles,
  timestamp
) {

  let left = 0;

  let right =
    candles.length -
    1;


  let result =
    -1;


  while (
    left <= right
  ) {

    const middle =
      Math.floor(
        (
          left +
          right
        ) /
        2
      );


    if (
      candles[
        middle
      ].closeTs <=
      timestamp
    ) {

      result =
        middle;


      left =
        middle +
        1;

    } else {

      right =
        middle -
        1;

    }

  }


  return result;

}


/* ================================================================
   CONTEXT
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


  const timestamp =
    m5.closeTs;


  const m15Index =
    completedIndex(
      data.m15,
      timestamp
    );


  const h1Index =
    completedIndex(
      data.h1,
      timestamp
    );


  const h4Index =
    completedIndex(
      data.h4,
      timestamp
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
      ],

    m15Index,

    h1Index,

    h4Index

  };

}


/* ================================================================
   VALID CONTEXT
================================================================ */

function validContext(
  context
) {

  if (!context) {
    return false;
  }


  for (
    const key of [
      "m5",
      "m15",
      "h1",
      "h4"
    ]
  ) {

    const candle =
      context[key];


    if (
      !Number.isFinite(
        candle.ema20
      ) ||
      !Number.isFinite(
        candle.ema50
      ) ||
      !Number.isFinite(
        candle.ema200
      )
    ) {

      return false;

    }

  }


  return true;

}


/* ================================================================
   FIRST VALID INDEX
================================================================ */

function firstValidIndex(
  data
) {

  for (
    let i = 0;
    i < data.m5.length;
    i++
  ) {

    const context =
      getContext(
        data,
        i
      );


    if (
      validContext(
        context
      )
    ) {

      return i;

    }

  }


  return -1;

}


/* ================================================================
   TREND STATES
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
   REGIME QUALITY
================================================================ */

function regimeQuality(
  context,
  side,
  settings
) {

  if (
    !Number.isFinite(
      context.h1.adx14
    ) ||
    !Number.isFinite(
      context.m15.adx14
    ) ||
    !Number.isFinite(
      context.h1.gap2050ATR
    ) ||
    !Number.isFinite(
      context.m15.gap2050ATR
    ) ||
    !Number.isFinite(
      context.h4.gap50200ATR
    )
  ) {

    return false;

  }


  /*
   * Direction.
   */

  if (
    side === 1
  ) {

    if (
      !h4Bull(
        context.h4
      ) ||
      !h1Bull(
        context.h1
      ) ||
      !m15Bull(
        context.m15
      )
    ) {

      return false;

    }

  } else {

    if (
      !h4Bear(
        context.h4
      ) ||
      !h1Bear(
        context.h1
      ) ||
      !m15Bear(
        context.m15
      )
    ) {

      return false;

    }

  }


  /*
   * Trend strength.
   */

  if (
    context.h1.adx14 <
    settings.minH1ADX
  ) {

    return false;

  }


  if (
    context.m15.adx14 <
    settings.minM15ADX
  ) {

    return false;

  }


  /*
   * EMA separation.
   */

  if (
    context.h1.gap2050ATR <
    settings.minH1GapATR
  ) {

    return false;

  }


  if (
    context.m15.gap2050ATR <
    settings.minM15GapATR
  ) {

    return false;

  }


  if (
    context.h4.gap50200ATR <
    settings.minH4GapATR
  ) {

    return false;

  }


  /*
   * Avoid heavily deteriorating
   * local trend strength.
   */

  if (
    Number.isFinite(
      context.m15.adxDelta
    ) &&
    context.m15.adxDelta <
    settings.minM15AdxDelta
  ) {

    return false;

  }


  return true;

}


/* ================================================================
   CANDLE BODY
================================================================ */

function bodyRatio(
  candle
) {

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

      const touched =
        candle.low <=
        candle.ema20 +
        tolerance;


      const notTooDeep =
        candle.low >=
        candle.ema50 -
        candle.atr14 *
        settings.maxPullbackDepthATR;


      if (
        touched &&
        notTooDeep
      ) {

        return true;

      }

    } else {

      const touched =
        candle.high >=
        candle.ema20 -
        tolerance;


      const notTooDeep =
        candle.high <=
        candle.ema50 +
        candle.atr14 *
        settings.maxPullbackDepthATR;


      if (
        touched &&
        notTooDeep
      ) {

        return true;

      }

    }

  }


  return false;

}


/* ================================================================
   CONTINUATION
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


    const momentumClose =
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
      momentumClose
    );

  }


  const strictBreak =
    current.close <
    previous.low;


  const momentumClose =
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
    momentumClose
  );

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

    score += 20;

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

    score += 20;

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

    score += 15;

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

    score += 10;

  }


  if (
    context.h1.adx14 >=
    settings.minH1ADX
  ) {

    score += 10;

  }


  if (
    context.m15.adx14 >=
    settings.minM15ADX
  ) {

    score += 10;

  }


  if (
    context.h1.gap2050ATR >=
    settings.minH1GapATR
  ) {

    score += 5;

  }


  if (
    context.m15.gap2050ATR >=
    settings.minM15GapATR
  ) {

    score += 5;

  }


  if (
    context.h4.gap50200ATR >=
    settings.minH4GapATR
  ) {

    score += 5;

  }


  return score;

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


  if (
    !validContext(
      context
    )
  ) {

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
    )
  ) {

    return null;

  }


  /*
   * Session.
   */

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


  /*
   * Minimum M5 volatility.
   */

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
     BUY
  ============================================================ */

  if (
    regimeQuality(
      context,
      1,
      settings
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


    const chaseATR =
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
      chaseATR <=
        settings.maxChaseATR
    ) {

      return {

        side: 1,

        score,

        context

      };

    }

  }


  /* ============================================================
     SELL
  ============================================================ */

  if (
    regimeQuality(
      context,
      -1,
      settings
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


    const chaseATR =
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
      chaseATR <=
        settings.maxChaseATR
    ) {

      return {

        side: -1,

        score,

        context

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

    let swingLow =
      Infinity;


    for (
      let i = start;
      i <= signalIndex;
      i++
    ) {

      swingLow =
        Math.min(
          swingLow,
          candles[i].low
        );

    }


    let stop =
      swingLow -
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


  let swingHigh =
    -Infinity;


  for (
    let i = start;
    i <= signalIndex;
    i++
  ) {

    swingHigh =
      Math.max(
        swingHigh,
        candles[i].high
      );

  }


  let stop =
    swingHigh +
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
   SIMULATE TRADE
================================================================ */

function simulateTrade(
  data,
  signalIndex,
  signal,
  settings
) {

  const entryIndex =
    signalIndex +
    1;


  if (
    entryIndex >=
    data.m5.length
  ) {

    return null;

  }


  const entryBar =
    data.m5[
      entryIndex
    ];


  const entry =
    entryBar.open;


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


  const lastIndex =
    Math.min(

      data.m5.length -
      1,

      entryIndex +
      settings.maxHoldBars

    );


  let exitIndex =
    lastIndex;


  let exitPrice =
    data.m5[
      lastIndex
    ].close;


  let result =
    "TIME";


  let rawR =
    null;


  for (
    let i = entryIndex;
    i <= lastIndex;
    i++
  ) {

    const bar =
      data.m5[i];


    /* BUY */

    if (
      signal.side === 1
    ) {

      const stopHit =
        bar.low <=
        activeStop;


      const targetHit =
        bar.high >=
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
        bar.high >=
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
        bar.high >=
        activeStop;


      const targetHit =
        bar.low <=
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
        bar.low <=
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
        entryBar.ts
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

function calculateMetrics(
  trades,
  settings,
  includeCurve = false
) {

  let wins = 0;

  let losses = 0;

  let breakevens = 0;

  let buys = 0;

  let sells = 0;


  let grossProfit = 0;

  let grossLoss = 0;

  let totalR = 0;


  let equity =
    settings.initialBalance;


  let peak =
    equity;


  let maxDrawdown =
    0;


  const curve =
    includeCurve
      ? [
          {
            trade: 0,

            equity:
              round(
                equity,
                2
              )
          }
        ]
      : [];


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
      trade.result ===
      "BE"
    ) {

      breakevens++;

    } else if (
      r > 0
    ) {

      wins++;

    } else {

      losses++;

    }


    if (
      r > 0
    ) {

      grossProfit +=
        r;

    } else if (
      r < 0
    ) {

      grossLoss +=
        Math.abs(r);

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
      peak > 0
        ? (
            (
              peak -
              equity
            ) /
            peak
          ) *
          100
        : 0;


    maxDrawdown =
      Math.max(
        maxDrawdown,
        dd
      );


    if (
      includeCurve
    ) {

      curve.push({

        trade:
          i + 1,

        equity:
          round(
            equity,
            2
          )

      });

    }

  }


  const count =
    trades.length;


  const winRate =
    count > 0
      ? (
          wins /
          count
        ) *
        100
      : 0;


  const profitFactor =
    grossLoss > 0
      ? grossProfit /
        grossLoss
      : grossProfit > 0
        ? 99
        : 0;


  const expectancy =
    count > 0
      ? totalR /
        count
      : 0;


  const returnPct =
    settings.initialBalance > 0
      ? (
          (
            equity -
            settings.initialBalance
          ) /
          settings.initialBalance
        ) *
        100
      : 0;


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
        profitFactor,
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

    equityCurve:
      curve

  };

}


/* ================================================================
   FOUR WINDOW STABILITY TEST
================================================================ */

function stabilityWindows(
  trades,
  startTime,
  endTime,
  settings
) {

  const windows = [];


  const duration =
    (
      endTime -
      startTime
    ) /
    4;


  let positiveWindows =
    0;


  for (
    let i = 0;
    i < 4;
    i++
  ) {

    const windowStart =
      startTime +
      duration *
      i;


    const windowEnd =
      i === 3
        ? endTime +
          1
        : startTime +
          duration *
          (
            i + 1
          );


    const windowTrades =
      trades.filter(
        trade => {

          const time =
            Date.parse(
              trade.entryTime
            );


          return (
            time >=
              windowStart &&
            time <
              windowEnd
          );

        }
      );


    const metrics =
      calculateMetrics(
        windowTrades,
        settings,
        false
      );


    if (
      metrics.expectancyR >
      0
    ) {

      positiveWindows++;

    }


    windows.push({

      window:
        i + 1,

      start:
        new Date(
          windowStart
        ).toISOString(),

      end:
        new Date(
          windowEnd -
          1
        ).toISOString(),

      metrics

    });

  }


  return {

    positiveWindows,

    totalWindows: 4,

    windows

  };

}


/* ================================================================
   DEVELOPMENT ELIGIBILITY
================================================================ */

function developmentEligible(
  metrics
) {

  return (

    metrics.trades >=
      20

    &&

    metrics.profitFactor >
      1.05

    &&

    metrics.expectancyR >
      0.02

    &&

    metrics.totalR >
      0

  );

}


/* ================================================================
   DEVELOPMENT SELECTION SCORE
================================================================ */

function developmentScore(
  metrics
) {

  if (
    !developmentEligible(
      metrics
    )
  ) {

    /*
     * Negative score makes it impossible
     * to accidentally label an unprofitable
     * development result as deployable.
     */

    return (
      -1000 +
      metrics.expectancyR *
      10 +
      metrics.trades *
      0.01
    );

  }


  return (

    metrics.expectancyR *
      35

    +

    Math.min(
      metrics.profitFactor,
      3
    ) *
      9

    +

    Math.min(
      metrics.trades,
      120
    ) *
      0.10

    -

    metrics.maxDrawdown *
      1.50

  );

}


/* ================================================================
   GRADE
================================================================ */

function gradeStrategy(
  overall,
  development,
  validation,
  stability,
  direction
) {

  if (
    !developmentEligible(
      development
    )
  ) {

    return {

      grade:
        "NO EDGE",

      verdict:
        "Development sample does not contain a positive historical edge."

    };

  }


  if (
    overall.trades <
    40
  ) {

    return {

      grade:
        "P",

      verdict:
        "Promising, but the total trade sample is still small."

    };

  }


  if (
    validation.trades <
    10
  ) {

    return {

      grade:
        "P",

      verdict:
        "Development is positive, but validation sample is too small."

    };

  }


  const bothDirections =
    direction.long.trades >=
      5 &&
    direction.short.trades >=
      5;


  if (
    overall.trades >= 80 &&
    validation.trades >= 20 &&
    development.profitFactor >=
      1.20 &&
    development.expectancyR >
      0.08 &&
    validation.profitFactor >=
      1.15 &&
    validation.expectancyR >
      0 &&
    stability.positiveWindows >=
      3 &&
    overall.maxDrawdown <=
      12 &&
    bothDirections
  ) {

    return {

      grade:
        "A",

      verdict:
        "Strong multi-period historical result."

    };

  }


  if (
    overall.trades >= 50 &&
    validation.trades >= 12 &&
    development.profitFactor >
      1.10 &&
    development.expectancyR >
      0.04 &&
    validation.expectancyR >=
      0 &&
    stability.positiveWindows >=
      3 &&
    overall.maxDrawdown <=
      16
  ) {

    return {

      grade:
        "B",

      verdict:
        bothDirections
          ? "Promising and relatively stable historical edge."
          : "Promising, but directional coverage is still incomplete."

    };

  }


  return {

    grade:
      "C",

    verdict:
      "Positive development edge, but robustness needs more evidence."

  };

}


/* ================================================================
   RUN PROFILE
================================================================ */

function runProfile(
  data,
  startIndex,
  settings
) {

  const trades = [];


  let index =
    startIndex;


  while (
    index <
    data.m5.length -
    1
  ) {

    const signal =
      getSignal(
        data,
        index,
        settings
      );


    if (!signal) {

      index++;

      continue;

    }


    const trade =
      simulateTrade(

        data,

        index,

        signal,

        settings

      );


    if (!trade) {

      index++;

      continue;

    }


    trades.push(
      trade
    );


    index =
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


  const splitTime =
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
        splitTime
    );


  const validationTrades =
    trades.filter(
      trade =>
        Date.parse(
          trade.entryTime
        ) >=
        splitTime
    );


  const longTrades =
    trades.filter(
      trade =>
        trade.side ===
        "BUY"
    );


  const shortTrades =
    trades.filter(
      trade =>
        trade.side ===
        "SELL"
    );


  const overall =
    calculateMetrics(
      trades,
      settings,
      true
    );


  const development =
    calculateMetrics(
      developmentTrades,
      settings,
      false
    );


  const validation =
    calculateMetrics(
      validationTrades,
      settings,
      false
    );


  const direction = {

    long:
      calculateMetrics(
        longTrades,
        settings,
        false
      ),

    short:
      calculateMetrics(
        shortTrades,
        settings,
        false
      )

  };


  const stability =
    stabilityWindows(
      trades,
      startTime,
      endTime,
      settings
    );


  const grade =
    gradeStrategy(
      overall,
      development,
      validation,
      stability,
      direction
    );


  const selectionScore =
    developmentScore(
      development
    );


  return {

    profile:
      settings.profile,

    settings,

    splitTime:
      new Date(
        splitTime
      ).toISOString(),

    deployable:
      developmentEligible(
        development
      ),

    selectionScore:
      round(
        selectionScore,
        3
      ),

    metrics: {

      ...overall,

      grade:
        grade.grade,

      verdict:
        grade.verdict

    },

    development,

    validation,

    direction,

    stability,

    trades

  };

}


/* ================================================================
   PROFILES
================================================================ */

function profiles(
  base
) {

  return [

    /* ============================================================
       QUALITY

       Trades only established,
       high-strength trends.
    ============================================================ */

    {

      ...base,

      profile:
        "QUALITY",

      minScore:
        85,

      minH1ADX:
        20,

      minM15ADX:
        20,

      minH1GapATR:
        0.25,

      minM15GapATR:
        0.18,

      minH4GapATR:
        0.35,

      minM15AdxDelta:
        0,

      pullbackBars:
        6,

      pullbackToleranceATR:
        0.22,

      maxPullbackDepthATR:
        0.65,

      minBody:
        0.36,

      strongBody:
        0.48,

      maxChaseATR:
        0.90,

      longRsiMin:
        46,

      longRsiMax:
        70,

      shortRsiMin:
        30,

      shortRsiMax:
        54,

      cooldownBars:
        2

    },


    /* ============================================================
       BALANCED
    ============================================================ */

    {

      ...base,

      profile:
        "BALANCED",

      minScore:
        75,

      minH1ADX:
        17,

      minM15ADX:
        16,

      minH1GapATR:
        0.18,

      minM15GapATR:
        0.12,

      minH4GapATR:
        0.22,

      minM15AdxDelta:
        -2,

      pullbackBars:
        8,

      pullbackToleranceATR:
        0.28,

      maxPullbackDepthATR:
        0.78,

      minBody:
        0.30,

      strongBody:
        0.42,

      maxChaseATR:
        1.10,

      longRsiMin:
        43,

      longRsiMax:
        72,

      shortRsiMin:
        28,

      shortRsiMax:
        57,

      cooldownBars:
        1

    },


    /* ============================================================
       ACTIVE
    ============================================================ */

    {

      ...base,

      profile:
        "ACTIVE",

      minScore:
        70,

      minH1ADX:
        15,

      minM15ADX:
        14,

      minH1GapATR:
        0.12,

      minM15GapATR:
        0.08,

      minH4GapATR:
        0.15,

      minM15AdxDelta:
        -4,

      pullbackBars:
        10,

      pullbackToleranceATR:
        0.35,

      maxPullbackDepthATR:
        0.95,

      minBody:
        0.24,

      strongBody:
        0.35,

      maxChaseATR:
        1.30,

      longRsiMin:
        40,

      longRsiMax:
        75,

      shortRsiMin:
        25,

      shortRsiMax:
        60,

      cooldownBars:
        0

    }

  ];

}


/* ================================================================
   TIMEFRAME STATE
================================================================ */

function timeframeState(
  candle,
  timeframe
) {

  let direction =
    "MIXED";


  if (
    timeframe ===
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
    timeframe ===
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
    timeframe ===
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
    timeframe ===
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
      ),

    adxDelta:
      round(
        candle.adxDelta,
        2
      ),

    gap2050ATR:
      round(
        candle.gap2050ATR,
        2
      ),

    gap50200ATR:
      round(
        candle.gap50200ATR,
        2
      )

  };

}


/* ================================================================
   CURRENT MARKET
================================================================ */

function latestState(
  data,
  settingsList
) {

  const index =
    data.m5.length -
    1;


  const context =
    getContext(
      data,
      index
    );


  if (
    !validContext(
      context
    )
  ) {

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


  const profilesLive =
    settingsList.map(
      settings => {

        const signal =
          getSignal(
            data,
            index,
            settings
          );


        return {

          profile:
            settings.profile,

          signal:
            signal
              ? (
                  signal.side === 1
                    ? "BUY"
                    : "SELL"
                )
              : "WAIT",

          score:
            signal
              ? signal.score
              : null

        };

      }
    );


  return {

    time:
      new Date(
        context.m5.closeTs
      ).toISOString(),

    price:
      round(
        context.m5.close,
        2
      ),

    bias,

    profiles:
      profilesLive,

    timeframes: {

      m5:
        timeframeState(
          context.m5,
          "M5"
        ),

      m15:
        timeframeState(
          context.m15,
          "M15"
        ),

      h1:
        timeframeState(
          context.h1,
          "H1"
        ),

      h4:
        timeframeState(
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

  targetBars: null,

  expires: 0,

  data: null

};


/* ================================================================
   LOAD DATA
================================================================ */

async function loadData(
  targetBars
) {

  if (
    CACHE.data &&
    CACHE.targetBars ===
      targetBars &&
    CACHE.expires >
      Date.now()
  ) {

    return CACHE.data;

  }


  const m5 =
    await fetchM5History(
      targetBars
    );


  if (
    m5.length <
    10000
  ) {

    throw new Error(
      `Only ${m5.length} M5 candles were returned. More history is required for robust H4 EMA200 testing.`
    );

  }


  const data =
    buildData(
      m5
    );


  CACHE = {

    targetBars,

    expires:
      Date.now() +
      60000,

    data

  };


  return data;

}


/* ================================================================
   COMPACT RESULT
================================================================ */

function compact(
  metrics
) {

  return {

    trades:
      metrics.trades,

    wins:
      metrics.wins,

    losses:
      metrics.losses,

    breakevens:
      metrics.breakevens,

    buys:
      metrics.buys,

    sells:
      metrics.sells,

    winRate:
      metrics.winRate,

    profitFactor:
      metrics.profitFactor,

    expectancyR:
      metrics.expectancyR,

    totalR:
      metrics.totalR,

    maxDrawdown:
      metrics.maxDrawdown

  };

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
    "no-store, no-cache, must-revalidate"
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


    /*
     * Default is deliberately longer
     * than V1.3.
     */

    const requestedBars =
      integerParam(
        q.bars,
        18000,
        6000,
        25000
      );


    /*
     * Your latest posted run produced
     * +1.46R TP outcomes after 0.04R cost.
     *
     * That means gross target = 1.50R.
     *
     * Therefore V1.4 defaults to 1.50.
     */

    const targetR =
      numberParam(
        q.targetR,
        1.5,
        0.5,
        5
      );


    const riskPct =
      numberParam(
        q.riskPct,
        0.5,
        0.01,
        5
      );


    const costR =
      numberParam(
        q.costR,
        0.04,
        0,
        0.5
      );


    const initialBalance =
      numberParam(
        q.initialBalance,
        10000,
        100,
        100000000
      );


    const useBreakeven =
      boolParam(
        q.useBreakeven,
        true
      );


    const breakevenR =
      numberParam(
        q.breakevenR,
        1.0,
        0.25,
        3
      );


    const useSession =
      boolParam(
        q.useSession,
        true
      );


    const sessionStart =
      integerParam(
        q.sessionStart,
        5,
        0,
        23
      );


    const sessionEnd =
      integerParam(
        q.sessionEnd,
        19,
        0,
        23
      );


    /*
     * Need evaluation bars
     * plus indicator warm-up.
     */

    const historyTarget =
      Math.min(

        requestedBars +
        WARMUP_M5_BARS,

        CHUNK_SIZE *
        MAX_CHUNKS

      );


    const data =
      await loadData(
        historyTarget
      );


    const firstValid =
      firstValidIndex(
        data
      );


    if (
      firstValid <
      0
    ) {

      throw new Error(
        "Unable to obtain enough valid H4 EMA200 history."
      );

    }


    const startIndex =
      Math.max(

        firstValid,

        data.m5.length -
        requestedBars

      );


    const evaluatedBars =
      data.m5.length -
      startIndex;


    if (
      evaluatedBars <
      3000
    ) {

      throw new Error(
        `Only ${evaluatedBars} valid evaluation candles remain after H4 warm-up.`
      );

    }


    const base = {

      targetR,

      riskPct,

      costR,

      initialBalance,

      useBreakeven,

      breakevenR,

      useSession,

      sessionStart,

      sessionEnd,

      swingLookback:
        6,

      structureBufferATR:
        0.15,

      minStopATR:
        0.80,

      maxStopATR:
        2.0,

      maxHoldBars:
        48,

      minAtrPct:
        0.015

    };


    const settingsList =
      profiles(
        base
      );


    const results =
      settingsList.map(
        settings =>
          runProfile(

            data,

            startIndex,

            settings

          )
      );


    /*
     * Ranking uses DEVELOPMENT ONLY.
     */

    const ranked =
      [
        ...results
      ]
        .sort(
          (
            a,
            b
          ) =>
            b.selectionScore -
            a.selectionScore
        );


    /*
     * Candidate must pass positive
     * development gate.
     */

    const eligible =
      ranked.filter(
        result =>
          result.deployable
      );


    const deployable =
      eligible.length >
      0;


    /*
     * If nothing qualifies,
     * still return best diagnostic profile
     * but clearly label NO EDGE.
     */

    const selected =
      deployable
        ? eligible[0]
        : ranked[0];


    const startTime =
      data.m5[
        startIndex
      ].ts;


    const endTime =
      data.m5[
        data.m5.length -
        1
      ].closeTs;


    let regimeCoverage =
      "BOTH DIRECTIONS";


    if (
      selected.metrics.buys ===
        0 &&
      selected.metrics.sells >
        0
    ) {

      regimeCoverage =
        "SHORT ONLY";

    }


    if (
      selected.metrics.sells ===
        0 &&
      selected.metrics.buys >
        0
    ) {

      regimeCoverage =
        "LONG ONLY";

    }


    if (
      selected.metrics.trades ===
      0
    ) {

      regimeCoverage =
        "NO TRADES";

    }


    return res
      .status(200)
      .json({

        ok: true,

        strategy:
          "TYSON REGIME PULLBACK V1.4",

        symbol:
          SYMBOL,

        provider:
          "Twelve Data",

        sourceTimeframe:
          "M5",

        actualTargetR:
          targetR,

        costR,

        netFullTPR:
          round(
            targetR -
            costR,
            2
          ),

        netFullLossR:
          round(
            -1 -
            costR,
            2
          ),

        downloadedM5Bars:
          data.m5.length,

        requestedEvaluationBars:
          requestedBars,

        evaluatedM5Bars:
          evaluatedBars,

        period: {

          start:
            new Date(
              startTime
            ).toISOString(),

          end:
            new Date(
              endTime
            ).toISOString()

        },

        deployable,

        selectedProfile:
          deployable
            ? selected.profile
            : "NO ROBUST EDGE",

        diagnosticProfile:
          selected.profile,

        regimeCoverage,

        selected: {

          profile:
            selected.profile,

          deployable:
            selected.deployable,

          selectionScore:
            selected.selectionScore,

          splitTime:
            selected.splitTime,

          settings:
            selected.settings,

          metrics:
            selected.metrics,

          development:
            selected.development,

          validation:
            selected.validation,

          direction:
            selected.direction,

          stability:
            selected.stability

        },

        profiles:
          ranked.map(
            result => ({

              profile:
                result.profile,

              deployable:
                result.deployable,

              selectionScore:
                result.selectionScore,

              metrics:
                compact(
                  result.metrics
                ),

              grade:
                result.metrics.grade,

              verdict:
                result.metrics.verdict,

              development:
                compact(
                  result.development
                ),

              validation:
                compact(
                  result.validation
                ),

              direction: {

                long:
                  compact(
                    result.direction.long
                  ),

                short:
                  compact(
                    result.direction.short
                  )

              },

              positiveWindows:
                result.stability
                  .positiveWindows

            })
          ),

        latest:
          latestState(
            data,
            settingsList
          ),

        trades:
          selected.trades
            .slice(-500)
            .reverse(),

        assumptions: [

          "Best profile is selected using development data only.",

          "A profile cannot be deployable with negative development expectancy.",

          "Validation data never influences selection.",

          "M15, H1 and H4 are aggregated from the same M5 source.",

          "Only completed M5 candles create signals.",

          "Higher-timeframe candles are unavailable until their scheduled close.",

          "Entry occurs on the next M5 open.",

          "SL is assumed first if SL and TP occur within the same M5 candle.",

          "Breakeven becomes active only for following candles.",

          "Trading cost is deducted from every result.",

          "Historical results do not guarantee future performance."

        ]

      });


  } catch (
    error
  ) {

    console.error(
      "V1.4 ERROR:",
      error
    );


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