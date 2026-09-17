-- Non-destructive deactivation: retain child receipts, sessions, origins,
-- compatible indexes and every history guard. Never restore the old unique
-- adoption constraint over retained children or drop supplementation history.
UPDATE new_design.resource_supplement_capabilities SET operational=false
WHERE contract_key='stable_resource_supplements_v1';
