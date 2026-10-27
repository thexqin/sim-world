// In-world clock. Day and hour are stored state (not derived from tick),
// so changing day length mid-run doesn't make the date jump.

export function createClock(cfg) {
  return { day: 1, hour: cfg.startHour };
}

export function advanceClock(clock, cfg) {
  clock.hour += 24 / cfg.ticksPerDay;
  if (clock.hour >= 24) {
    clock.hour -= 24;
    clock.day++;
  }
}

// Day/night and lighting for the current clock.
export function clockInfo(clock, cfg) {
  const { day, hour } = clock;
  const { nightStartHour: start, nightEndHour: end, twilightHours: tw } = cfg;

  const isNight = start > end ? hour >= start || hour < end : hour >= start && hour < end;

  // Darkness 0..1, fading in/out over the twilight window.
  let darkness = isNight ? 1 : 0;
  if (!isNight && tw > 0) {
    const toDusk = start - hour; // hours until night begins
    const sinceDawn = hour - end; // hours since night ended
    if (toDusk > 0 && toDusk < tw) darkness = 1 - toDusk / tw;
    else if (sinceDawn >= 0 && sinceDawn < tw) darkness = 1 - sinceDawn / tw;
  }

  return { day, hour, isNight, darkness: darkness * cfg.nightDarkness };
}
