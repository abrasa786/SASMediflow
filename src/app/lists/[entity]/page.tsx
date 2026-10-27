import ListView from "@/components/ListView";

export default function ListPage({ params }: { params: { entity: string } }) {
  return <ListView entity={params.entity} />;
}
