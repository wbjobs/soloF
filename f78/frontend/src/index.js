import React from 'react';
import ReactDOM from 'react-dom/client';
import { ApolloClient, InMemoryCache, ApolloProvider } from '@apollo/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';

const client = new ApolloClient({
  uri: process.env.REACT_APP_GRAPHQL_URL || '/query',
  cache: new InMemoryCache(),
});

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <ApolloProvider client={client}>
    <ConfigProvider locale={zhCN}>
      <App />
    </ConfigProvider>
  </ApolloProvider>
);
