-- Migration 08: GTFS stop_times schedules for real timetable departures and ride durations

CREATE TABLE IF NOT EXISTS route_schedules (
  route_id TEXT NOT NULL,
  direction_id SMALLINT NOT NULL,
  day_type CHAR(1) NOT NULL, -- 'u' (Sun), 'w' (Mon-Thu), 'f' (Fri), 's' (Sat)
  departure_minutes SMALLINT[] NOT NULL,
  stop_offset_minutes SMALLINT[] NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (route_id, direction_id, day_type)
);
