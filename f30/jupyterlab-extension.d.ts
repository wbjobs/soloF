declare module '*.svg' {
  const value: string;
  export default value;
}

declare module '*.png' {
  const value: string;
  export default value;
}

declare module '*.jpg' {
  const value: string;
  export default value;
}

declare module '*.gif' {
  const value: string;
  export default value;
}

declare module '*.css' {
  const value: any;
  export default value;
}

declare module '*.html' {
  const value: string;
  export default value;
}

declare module 'plotly.js-dist-min' {
  import * as Plotly from 'plotly.js';
  export = Plotly;
}
