// Stand-in for the optional x402 packages that @coinbase/cdp-sdk imports (see next.config.ts).
// Stock Port never uses x402 payments. Every export exists so the bundler can resolve the
// imports, and each one throws if it is ever actually used.
const unavailable = () => {
  throw new Error("x402 is not available in Stock Port");
};
class Unavailable {
  constructor() {
    unavailable();
  }
}

// functions
export const toClientEvmSigner = unavailable;
export const registerExactEvmScheme = unavailable;
export const registerExactSvmScheme = unavailable;
export const wrapFetchWithPayment = unavailable;
export const paymentMiddlewareFromConfig = unavailable;
export const paymentMiddlewareFromHTTPServer = unavailable;
export const builderCodeResourceServerExtension = unavailable;
export const bazaarResourceServerExtension = unavailable;

// classes
export class x402Client extends Unavailable {}
export class x402ResourceServer extends Unavailable {}
export class x402HTTPResourceServer extends Unavailable {}
export class HTTPFacilitatorClient extends Unavailable {}
export class ExactEvmScheme extends Unavailable {}
export class ExactEvmSchemeV1 extends Unavailable {}
export class UptoEvmScheme extends Unavailable {}
export class AuthCaptureEvmScheme extends Unavailable {}
export class BatchSettlementEvmScheme extends Unavailable {}
export class ExactSvmScheme extends Unavailable {}
export class ExactSvmSchemeV1 extends Unavailable {}
export class UptoSvmScheme extends Unavailable {}
export class BuilderCodeClientExtension extends Unavailable {}

// constants / schemas
export const BUILDER_CODE = "";
export const BUILDER_CODE_PATTERN = /$^/;
export const BUILDER_CODE_SCHEMA = {};
export const PaymentRequirementsV1Schema = {};
export const PaymentRequirementsV2Schema = {};

const stub = {};
export default stub;
