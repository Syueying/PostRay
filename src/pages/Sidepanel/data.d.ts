export type userDataType = {
    username: string;
    pwd: string;
    type: number;
    updatedAt?: string; // ISO date — when subscription was last activated. Expiry = updatedAt + 30 days.
}

export type crawlAccountType = {
    accountId: string;
    startDate: string;
    endDate: string;
}

export type HistoryDataType = {
    runId: number;
    accountId: string;
    startTime: string;
    endTime: string;
}