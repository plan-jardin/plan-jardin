function calculateGDD(min, max, base, limit) {
    const adjustedMin = Math.max(min, base);
    const adjustedMax = Math.min(max, limit);

    return Math.max(0, (adjustedMin + adjustedMax) / 2 - base);
}

export async function accumulatedGddAtDates(
    getWeatherForDate,
    startDate,
    targetDates,
    crop,
) {
    const targets = new Set(targetDates);
    const totals = new Map([...targets].map((date) => [date, 0]));
    if (targets.size === 0) return totals;

    const start = new Date(startDate);
    const latestTarget = [...targets].sort().at(-1);
    const end = new Date(`${latestTarget}T00:00:00.000Z`);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) {
        return totals;
    }

    let total = 0;
    const dateCursor = new Date(start);
    while (dateCursor <= end) {
        const weather = await getWeatherForDate(dateCursor);
        total += calculateGDD(weather?.min, weather?.max, crop.baseTemperature, crop.upperLimit);
        const date = dateCursor.toISOString().slice(0, 10);
        if (targets.has(date)) totals.set(date, total);
        dateCursor.setUTCDate(dateCursor.getUTCDate() + 1);
    }

    return totals;
}

export async function expectedHarvestDate(
    getWeatherForDate,
    startDate,
    crop
) {
    let total = 0;
    const todaysDate = new Date();
    let accumulatedToDate = 0;

    for (
        const dateCursor = new Date(startDate);
        ;
        dateCursor.setUTCDate(dateCursor.getUTCDate() + 1)
    ) {
        const weather = await getWeatherForDate(dateCursor);

        total += calculateGDD(weather?.min, weather?.max, crop.baseTemperature, crop.upperLimit);
        if (dateCursor < todaysDate) {
            accumulatedToDate = total;
        }
        if (total >= crop.requiredGDD) {
            return {
                harvestDate: dateCursor,
                completeness: accumulatedToDate / crop.requiredGDD,
                accumulatedGDD: accumulatedToDate,
                requiredGDD: crop.requiredGDD,
            };
        }
    }
}