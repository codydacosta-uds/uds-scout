export type PipelineFailureStep = {
  number: number;
  name: string;
  status: string;
  conclusion: string | null;
};

export type PipelineFailureJob = {
  id: number;
  name: string;
  url: string;
  status: string;
  conclusion: string | null;
  failedSteps: PipelineFailureStep[];
};

export type PipelineFailureDetail = {
  run: {
    id: number;
    name: string;
    title: string;
    url: string;
    status: string;
    conclusion: string | null;
    branch: string | null;
    updatedAt: string;
  };
  jobs: PipelineFailureJob[];
};
