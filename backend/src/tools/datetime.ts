export const getDateTime = (timezone = "UTC"): string => {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      dateStyle: "full",
      timeStyle: "long",
    });
    return `${formatter.format(new Date())} (${timezone})`;
  } catch {
    throw new Error(
      "Invalid timezone. Use an IANA timezone like Asia/Kolkata or America/New_York.",
    );
  }
};
