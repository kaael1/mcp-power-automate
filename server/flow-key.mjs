export const makeFlowKey = ({ envId, flowId }) => `${envId}:${flowId}`;

export const parseFlowKey = (key) => {
  if (!key || typeof key !== 'string' || !key.includes(':')) return null;

  const splitIndex = key.indexOf(':');
  return {
    envId: key.slice(0, splitIndex),
    flowId: key.slice(splitIndex + 1),
  };
};
