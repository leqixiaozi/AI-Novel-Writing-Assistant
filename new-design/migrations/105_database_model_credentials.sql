-- Manual migration. Apply only after a verified development backup and an isolated restore trial.
-- Existing env:// references remain readable until explicitly replaced with database secrets.
ALTER TABLE new_design.model_credential_refs
  ADD COLUMN secret_envelope bytea;

ALTER TABLE new_design.model_credential_refs
  ADD CONSTRAINT model_credential_secret_envelope_guard CHECK (
    (secret_locator = 'secret://database' AND secret_envelope IS NOT NULL AND octet_length(secret_envelope) > 29)
    OR (secret_locator <> 'secret://database' AND secret_envelope IS NULL)
  );
