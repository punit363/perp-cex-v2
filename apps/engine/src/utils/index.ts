const engine_response = (message: string, status: number, data?: any) => {
  return {
    message: message || "Unrecognised engine request action",
    status: status || 0,
    data: data || null,
  };
};

export { engine_response };
