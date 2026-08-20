/**
 * Signify's "root-bridge" CA — the issuer of every modern Hue Bridge certificate.
 *
 * Provenance: published in the Philips Hue developer documentation and mirrored at
 * https://github.com/callionica/hue/blob/master/certificates/hue_bridge_cacert.md
 *
 * Verified before embedding, against a live BSB002 (swversion 1978074000):
 *   subject = C=NL, O=Philips Hue, CN=root-bridge  (self-signed root)
 *   sha256  = F0:BD:8E:65:09:E8:2F:77:4D:63:BC:00:9D:53:88:C9:69:FE:3D:CF:7D:6D:54:1D:63:51:B7:2B:89:8D:8A:CF
 *   `openssl verify -CAfile hue-root-ca.pem <bridge leaf>` => OK
 *
 * The bridge serves only its leaf certificate (chain depth 0), so this root has to
 * be supplied by us — the OS trust store does not contain it.
 *
 * Valid until 2038-01-19.
 */
export const HUE_BRIDGE_ROOT_CA = `\
-----BEGIN CERTIFICATE-----
MIICMjCCAdigAwIBAgIUO7FSLbaxikuXAljzVaurLXWmFw4wCgYIKoZIzj0EAwIw
OTELMAkGA1UEBhMCTkwxFDASBgNVBAoMC1BoaWxpcHMgSHVlMRQwEgYDVQQDDAty
b290LWJyaWRnZTAiGA8yMDE3MDEwMTAwMDAwMFoYDzIwMzgwMTE5MDMxNDA3WjA5
MQswCQYDVQQGEwJOTDEUMBIGA1UECgwLUGhpbGlwcyBIdWUxFDASBgNVBAMMC3Jv
b3QtYnJpZGdlMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEjNw2tx2AplOf9x86
aTdvEcL1FU65QDxziKvBpW9XXSIcibAeQiKxegpq8Exbr9v6LBnYbna2VcaK0G22
jOKkTqOBuTCBtjAPBgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBhjAdBgNV
HQ4EFgQUZ2ONTFrDT6o8ItRnKfqWKnHFGmQwdAYDVR0jBG0wa4AUZ2ONTFrDT6o8
ItRnKfqWKnHFGmShPaQ7MDkxCzAJBgNVBAYTAk5MMRQwEgYDVQQKDAtQaGlsaXBz
IEh1ZTEUMBIGA1UEAwwLcm9vdC1icmlkZ2WCFDuxUi22sYpLlwJY81Wrqy11phcO
MAoGCCqGSM49BAMCA0gAMEUCIEBYYEOsa07TH7E5MJnGw557lVkORgit2Rm1h3B2
sFgDAiEA1Fj/C3AN5psFMjo0//mrQebo0eKd3aWRx+pQY08mk48=
-----END CERTIFICATE-----
`;

/**
 * Hue bridge certificates carry the bridge id as Common Name and no
 * subjectAltName at all, so the default hostname check can never pass against
 * an IP address. This is the whole reason PRD §63.2 asks for a dedicated
 * transport layer instead of a global `rejectUnauthorized: false`.
 */
export const BRIDGE_ID_PATTERN = /^[0-9a-f]{16}$/;
