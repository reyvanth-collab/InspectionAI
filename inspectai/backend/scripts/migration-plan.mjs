// Legacy installations need columns/tables that entered schema.sql before
// versioned release migrations existed. Preserve those migration files and
// order this explicit prerequisite first, regardless of its creation date.
export function migrationPlan(names) {
 return names.filter(name => name.endsWith('.sql')).sort((a, b) =>
  Number(!a.endsWith('_legacy_schema_bridge.sql')) - Number(!b.endsWith('_legacy_schema_bridge.sql')) || a.localeCompare(b))
}
