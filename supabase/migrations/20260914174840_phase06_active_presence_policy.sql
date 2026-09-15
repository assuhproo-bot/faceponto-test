-- The local test terminal records the exact active-presence policy that it runs.
-- It replaces placeholder liveness metadata from the development catalog only;
-- no biometric template or camera image is stored here.
update private.facial_profiles
set liveness_model_sha256 = '1c2f9ff1f849abfa656da4f7bad4300dc68180c5587056c18808f886d7d1002f',
    policy_version = 1
where active;
