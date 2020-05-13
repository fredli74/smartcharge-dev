import equal from "fast-deep-equal";

/* TODO REMOVE */
export function diff(objFrom: any, objTo: any, deep?: boolean): any {
  if (typeof objTo === "object" && !Array.isArray(objTo)) {
    const result: any = {};
    for (let key of Object.keys(objFrom)) {
      if (objTo[key] === undefined) {
        result[key] = undefined;
      }
    }
    for (let key of Object.keys(objTo)) {
      if (!equal(objFrom[key], objTo[key])) {
        if (deep) {
          result[key] = diff(objFrom[key], objTo[key], deep);
        } else {
          result[key] = objTo[key];
        }
      }
    }
    return result;
  }
  return objTo;
}
