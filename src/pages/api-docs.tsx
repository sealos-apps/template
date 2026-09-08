import { document } from '@/types/apis';
import dynamic from 'next/dynamic';

const ApiReferenceReact = dynamic(
  () => import('@scalar/api-reference-react').then(({ ApiReferenceReact }) => ApiReferenceReact),
  { ssr: false }
);

export default function ApiDocs() {
  const config = {
    content: document
  };

  return <ApiReferenceReact configuration={config} />;
}
