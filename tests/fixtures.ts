/** Resource shapes as returned by a Hue Bridge running API v2. */

export const CEILING_LIGHT = {
  id: 'light-ceiling',
  owner: { rid: 'device-ceiling', rtype: 'device' },
  metadata: { name: 'Sufit' },
  on: { on: true },
  dimming: { brightness: 72.4, min_dim_level: 0.2 },
  color_temperature: {
    mirek: 366,
    mirek_valid: true,
    mirek_schema: { mirek_minimum: 153, mirek_maximum: 500 },
  },
  color: {
    xy: { x: 0.4573, y: 0.41 },
    gamut: {
      red: { x: 0.6915, y: 0.3083 },
      green: { x: 0.17, y: 0.7 },
      blue: { x: 0.1532, y: 0.0475 },
    },
    gamut_type: 'C',
  },
  type: 'light',
};

/** A plain white bulb: no colour, no temperature — drives the capability checks. */
export const PLAIN_LIGHT = {
  id: 'light-plain',
  owner: { rid: 'device-plain', rtype: 'device' },
  metadata: { name: 'Lampka' },
  on: { on: false },
  type: 'light',
};

export const LIVING_ROOM = {
  id: 'room-living',
  children: [
    { rid: 'device-ceiling', rtype: 'device' },
    { rid: 'device-plain', rtype: 'device' },
  ],
  services: [
    { rid: 'grouped-living', rtype: 'grouped_light' },
    { rid: 'device-ceiling', rtype: 'device' },
  ],
  metadata: { name: 'Salon' },
  type: 'room',
};

export const LIVING_ROOM_GROUP = {
  id: 'grouped-living',
  owner: { rid: 'room-living', rtype: 'room' },
  on: { on: true },
  dimming: { brightness: 65 },
  type: 'grouped_light',
};

/** A scene attached to a room — the ordinary case. */
export const RELAX_SCENE = {
  id: 'scene-relax',
  metadata: { name: 'Relaks' },
  group: { rid: 'room-living', rtype: 'room' },
  status: { active: 'inactive' },
  type: 'scene',
};

/**
 * A scene attached to a zone. The app models rooms only, so this exercises the
 * path where a scene has no room to sit under and would otherwise be dropped.
 */
export const ZONE_SCENE = {
  id: 'scene-zone',
  metadata: { name: 'Wieczór' },
  group: { rid: 'zone-downstairs', rtype: 'zone' },
  status: { active: 'static' },
  type: 'scene',
};
