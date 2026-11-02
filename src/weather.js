
const OPEN_METEO = {
  archive: "https://archive-api.open-meteo.com/v1/archive",
  forecast: "https://api.open-meteo.com/v1/forecast",
};

const CACHE_PREFIX = "open-meteo-daily-v1";
const YEAR_CACHE_LIMIT = 12;
const yearMapCache = new Map();

/**
 * Returns daily maximum and minimum temperatures for a year.
 *
 * @param {Object} options
 * @param {number} options.latitude
 * @param {number} options.longitude
 * @param {number} options.year
 * @param {string} [options.timezone="auto"]
 * @param {number} [options.averageYears=10]
 *
 * @returns {Promise<Array<{
 *   date: string,
 *   max: number|null,
 *   min: number|null,
 *   source: "actual"|"forecast"|"average"
 * }>>}
 */
export async function getYearlyWeather({
  latitude,
  longitude,
  year,
  timezone = "auto",
  averageYears = 10,
}) {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    !Number.isInteger(year) ||
    !Number.isInteger(averageYears) ||
    averageYears < 1
  ) {
    throw new Error("Invalid weather parameters.");
  }

  const now = new Date();
  const currentYear = now.getFullYear();

  const pad = (n) => String(n).padStart(2, "0");

  const dateString = (date) =>
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

  const makeDate = (date) => new Date(
    `${date}T00:00:00`
  );

  const addDays = (date, days) => {
    const result = makeDate(date);
    result.setDate(result.getDate() + days);
    return dateString(result);
  };

  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  // Use UTC for determining the number of days in the requested year.
  const daysInYear = (
    Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)
  ) / 86400000;

  const allDates = Array.from(
    { length: daysInYear },
    (_, i) => new Date(Date.UTC(year, 0, i + 1))
      .toISOString()
      .slice(0, 10)
  );

  // Cache historical API responses.
  const cacheKey = (key) =>
    `${CACHE_PREFIX}:${latitude}:${longitude}:${timezone}:${key}`;

  function readCache(key) {
    try {
      const value = localStorage.getItem(cacheKey(key));
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  }

  function writeCache(key, value) {
    try {
      localStorage.setItem(cacheKey(key), JSON.stringify(value));
    } catch (error) {
      // Storage may be unavailable or full.
      console.warn("Weather cache could not be saved:", error);
    }
  }

  async function fetchDaily(url, cacheId = null) {
    if (cacheId) {
      const cached = readCache(cacheId);
      if (cached) return cached;
    }

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Open-Meteo error: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(data.reason || "Open-Meteo API error");
    }

    if (cacheId) {
      writeCache(cacheId, data);
    }

    return data;
  }

  function buildUrl(base, start, end) {
    const params = new URLSearchParams({
      latitude: latitude,
      longitude: longitude,
      start_date: start,
      end_date: end,
      daily: "temperature_2m_max,temperature_2m_min",
      timezone,
    });

    return `${base}?${params}`;
  }

  function toMap(data) {
    const result = new Map();

    const dates = data.daily.time;
    const max = data.daily.temperature_2m_max;
    const min = data.daily.temperature_2m_min;

    dates.forEach((date, i) => {
      result.set(date, {
        max: max[i] ?? null,
        min: min[i] ?? null,
      });
    });

    return result;
  }

  // Fetch actual historical temperatures for a date range.
  async function getActual(start, end, cacheId) {
    if (start > end) return new Map();

    const data = await fetchDaily(
      buildUrl(OPEN_METEO.archive, start, end),
      cacheId
    );

    return toMap(data);
  }

  async function getAverages(startYear, endYear) {
    const history = await getActual(
      `${startYear}-01-01`,
      `${endYear}-12-31`,
      `averages:${startYear}:${endYear}`
    );
    const groups = new Map();

    for (const [date, temperatures] of history) {
      const monthDay = date.slice(5);

      if (!groups.has(monthDay)) {
        groups.set(monthDay, { max: [], min: [] });
      }

      const group = groups.get(monthDay);
      if (Number.isFinite(temperatures.max)) group.max.push(temperatures.max);
      if (Number.isFinite(temperatures.min)) group.min.push(temperatures.min);
    }

    const averages = new Map();
    const mean = (values) => values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null;

    for (const [monthDay, values] of groups) {
      averages.set(monthDay, {
        max: mean(values.max),
        min: mean(values.min),
      });
    }

    return averages;
  }

  // Historical years: retrieve and cache the complete year.
  if (year < currentYear) {
    const actual = await getActual(
      yearStart,
      yearEnd,
      `actual:${year}`
    );

    return allDates.map((date) => ({
      date,
      max: actual.get(date)?.max ?? null,
      min: actual.get(date)?.min ?? null,
      source: "actual",
    }));
  }

  if (year > currentYear) {
    const averages = await getAverages(
      currentYear - averageYears,
      currentYear - 1
    );

    return allDates.map((date) => {
      const values = averages.get(date.slice(5));
      return {
        date,
        max: values?.max ?? null,
        min: values?.min ?? null,
        source: "average",
      };
    });
  }

  // Current year: split into actual, forecast and average periods.
  const today = dateString(now);

  // The next 14 calendar days, including today.
  const forecastEnd = addDays(
    today,
    13
  ) > yearEnd
    ? yearEnd
    : addDays(today, 13);

  // Actual data ends yesterday.
  const yesterday = addDays(today, -1);

  const actualEnd = yesterday < yearStart
    ? null
    : yesterday;

  const forecastStart = today;

  const averageStart = addDays(forecastEnd, 1);

  // 1. Actual historical data.
  const actualPromise = actualEnd
    ? getActual(
        yearStart,
        actualEnd,
        `actual:${year}:through:${actualEnd}`
      )
    : Promise.resolve(new Map());

  // 2. Current forecast (never cached).
  const forecastPromise = forecastStart <= forecastEnd
    ? fetchDaily(
        buildUrl(
          OPEN_METEO.forecast,
          forecastStart,
          forecastEnd
        )
      ).then(toMap)
    : Promise.resolve(new Map());

  // 3. Historical averages for the remaining dates.
  //
  // Request previous complete years in a single API call.
  // Cache this stable historical dataset.
  const averagePromise = averageStart <= yearEnd
    ? getAverages(year - averageYears, year - 1)
    : Promise.resolve(new Map());

  const [actual, forecast, averages] = await Promise.all([
    actualPromise,
    forecastPromise,
    averagePromise,
  ]);

  // Combine the three sources into one chronological result.
  return allDates.map((date) => {
    const monthDay = date.slice(5);

    if (actualEnd && date <= actualEnd) {
      const values = actual.get(date);

      return {
        date,
        max: values?.max ?? null,
        min: values?.min ?? null,
        source: "actual",
      };
    }

    if (date >= forecastStart && date <= forecastEnd) {
      const values = forecast.get(date);

      return {
        date,
        max: values?.max ?? null,
        min: values?.min ?? null,
        source: "forecast",
      };
    }

    const values = averages.get(monthDay);

    return {
      date,
      max: values?.max ?? null,
      min: values?.min ?? null,
      source: "average",
    };
  });
}

/**
 * Creates a memoized getter for daily weather at one location.
 *
 * @param {Object} options
 * @param {number} options.latitude
 * @param {number} options.longitude
 * @param {string} [options.timezone="auto"]
 * @param {number} [options.averageYears=10]
 * @returns {(date: Date) => Promise<{
 *   date: string,
 *   max: number|null,
 *   min: number|null,
 *   source: "actual"|"forecast"|"average"
 * }|null>}
 */
export function createWeatherGetter({
  latitude,
  longitude,
  timezone = "auto",
  averageYears = 10,
}) {
  const options = { latitude, longitude, timezone, averageYears };

  return async function getWeatherForDate(date) {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
      throw new TypeError("Date must be a valid Date object.");
    }

    const dateKey = date.toISOString().slice(0, 10);
    const year = date.getUTCFullYear();
    const weatherByDate = await getCachedYearMap(options, year);
    return weatherByDate.get(dateKey) ?? null;
  };
}

function getCachedYearMap(options, year) {
  const key = JSON.stringify([
    options.latitude,
    options.longitude,
    options.timezone,
    options.averageYears,
    year,
  ]);
  const cached = yearMapCache.get(key);

  if (cached) {
    yearMapCache.delete(key);
    yearMapCache.set(key, cached);
    return cached;
  }

  const pending = getYearlyWeather({ ...options, year })
    .then((weather) => new Map(weather.map((day) => [day.date, day])))
    .catch((error) => {
      if (yearMapCache.get(key) === pending) {
        yearMapCache.delete(key);
      }
      throw error;
    });

  yearMapCache.set(key, pending);

  if (yearMapCache.size > YEAR_CACHE_LIMIT) {
    yearMapCache.delete(yearMapCache.keys().next().value);
  }

  return pending;
}
