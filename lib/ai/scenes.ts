export const SCENES = ["portrait","landscape","night","street","food","macro","moving","indoor","backlit","sunset","architecture","pet","plant","general"] as const;
export type Scene = (typeof SCENES)[number];
