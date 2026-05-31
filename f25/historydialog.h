#ifndef HISTORYDIALOG_H
#define HISTORYDIALOG_H

#include <QDialog>
#include <QTableWidget>
#include <QLineEdit>
#include <QPushButton>
#include <QLabel>
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QGroupBox>
#include "databasemanager.h"

class HistoryDialog : public QDialog
{
    Q_OBJECT
public:
    explicit HistoryDialog(DatabaseManager *dbManager, QWidget *parent = nullptr);

private slots:
    void onQueryAll();
    void onQueryByAddress();
    void onClearRecords();
    void onRefreshCount();

private:
    DatabaseManager *m_dbManager;
    QTableWidget *m_tableWidget;
    QLineEdit *m_startAddrEdit;
    QLineEdit *m_endAddrEdit;
    QLabel *m_countLabel;

    void setupUI();
    void populateTable(const QList<ModbusRecord> &records);
    QString functionCodeToString(uint8_t funcCode);
};

#endif
