export const makeFlowKey = ({ envId, flowId }: { envId: string; flowId: string }) => `${envId}:${flowId}`;

export const parseFlowKey = (key: string) => {
  const [envId, flowId] = key.split(':');

  if (!envId || !flowId) {
    return null;
  }

  return { envId, flowId };
};
