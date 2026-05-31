import {
  ABCWidgetFactory,
  DocumentRegistry,
  IDocumentWidget
} from '@jupyterlab/docregistry';

import { NetCDFViewer } from './widget';

export class NetCDFViewerFactory extends ABCWidgetFactory<
  IDocumentWidget<NetCDFViewer>,
  DocumentRegistry.IModel
> {
  protected createNewWidget(
    context: DocumentRegistry.IContext<DocumentRegistry.IModel>
  ): IDocumentWidget<NetCDFViewer> {
    const viewer = new NetCDFViewer();
    viewer.loadFile(context.path);

    const widget: IDocumentWidget<NetCDFViewer> =
      viewer as IDocumentWidget<NetCDFViewer>;
    widget.context = context;

    return widget;
  }
}
