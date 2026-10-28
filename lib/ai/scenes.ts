export const SCENES = ["portrait","landscape","night","street","food","macro","moving","indoor","backlit","sunset","architecture","pet","general"] as const;
export type Scene = (typeof SCENES)[number];
