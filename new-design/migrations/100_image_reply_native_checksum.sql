-- Manual repair only. Never added to the author startup migration registry.
-- PostgreSQL 17 provides SHA-256 natively; do not require an undeclared extension.
DO $$
DECLARE definition text; original text := 'digest(decode(NEW.image_reply->>''base64'',''base64''),''sha256'')';
BEGIN
 definition := pg_get_functiondef('new_design.validate_image_generation_evidence()'::regprocedure);
 IF strpos(definition,original)=0 THEN RAISE EXCEPTION 'unexpected image reply checksum guard'; END IF;
 EXECUTE replace(definition,original,'pg_catalog.sha256(decode(NEW.image_reply->>''base64'',''base64''))');
END $$;
