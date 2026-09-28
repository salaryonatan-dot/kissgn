export class FinanceContractError extends Error {
    constructor(code, detail) {
        super("finance_contract:" + code);
        this.name = "FinanceContractError";
        this.code = code;
        this.detail = detail;
    }
}
