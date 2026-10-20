declare global {
    namespace Express {
        interface Request {
            user_id?: string; // Add user_id to the Request interface
        }
    }
}

export {}