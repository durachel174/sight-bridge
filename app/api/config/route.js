export async function GET() {
  const payload = {
    cloudVisionAvailable: Boolean(process.env.ANTHROPIC_API_KEY),
    localOcrAvailable: false,
    cloudVisionProvider: "Claude Vision API"
  };
  return Response.json(payload);
}
