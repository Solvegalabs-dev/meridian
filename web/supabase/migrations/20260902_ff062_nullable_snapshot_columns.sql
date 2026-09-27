-- FF-062: make RE-irrelevant snapshot columns nullable
-- collateral_risk, income_stress, recommended_action, top_signal_1/2/3
-- are not applicable for the RE sweep path and must accept NULL

ALTER TABLE case_signal_snapshots
ALTER COLUMN collateral_risk DROP NOT NULL,
ALTER COLUMN income_stress DROP NOT NULL,
ALTER COLUMN recommended_action DROP NOT NULL,
ALTER COLUMN top_signal_1 DROP NOT NULL,
ALTER COLUMN top_signal_2 DROP NOT NULL,
ALTER COLUMN top_signal_3 DROP NOT NULL;
