const handleError = (message: string, status: number) => {
    return {
      data: null,
      message: message || "Error processing request",
      status: "FAILURE",
      status_code: status || 0,
    };
  };

  const handleResponse = (message: string, status: number, data: any) => {
    return {
      data,
      message: message || "Request processed successfully",
      status: "SUCCESS",
      status_code: status || 1,
    };
  };

  export { handleResponse, handleError };
