// Which installed name of the tool a call is sent to: paid work goes to the
// metered name, everything else to the public one.
const DIR = "/opt/app/bin/";

export function commandFor(paid: boolean): string {
  return `${DIR}${paid ? "tool-metered" : "tool-public"}`;
}
