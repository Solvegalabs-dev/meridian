-- FF-089 Fix 3: regulatory pages change on a weekly-or-slower cadence — poll weekly.
UPDATE agent_configs
SET cadence_minutes = 10080
WHERE agent_key IN (
  'OUTDOOR_REGS_UT_ELK_SEASON',
  'OUTDOOR_REGS_UT_ELK_PERMITS',
  'OUTDOOR_REGS_UT_ELK_CLOSURES'
);
