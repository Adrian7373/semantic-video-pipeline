import StudioClient from "./StudioClient";

export default async function VideoStudioPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    return <StudioClient videoId={id} />;
}
