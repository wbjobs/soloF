#include "historydialog.h"
#include <QMessageBox>
#include <QHeaderView>

HistoryDialog::HistoryDialog(DatabaseManager *dbManager, QWidget *parent)
    : QDialog{parent}
    , m_dbManager(dbManager)
{
    setWindowTitle("历史数据查询");
    resize(1000, 600);
    setupUI();
    onRefreshCount();
    onQueryAll();
}

void HistoryDialog::setupUI()
{
    QVBoxLayout *mainLayout = new QVBoxLayout(this);

    QGroupBox *filterGroup = new QGroupBox("查询条件");
    QHBoxLayout *filterLayout = new QHBoxLayout(filterGroup);

    filterLayout->addWidget(new QLabel("起始地址:"));
    m_startAddrEdit = new QLineEdit();
    m_startAddrEdit->setPlaceholderText("十进制");
    filterLayout->addWidget(m_startAddrEdit);

    filterLayout->addWidget(new QLabel("结束地址:"));
    m_endAddrEdit = new QLineEdit();
    m_endAddrEdit->setPlaceholderText("可选，留空查询单地址");
    filterLayout->addWidget(m_endAddrEdit);

    QPushButton *queryAddrBtn = new QPushButton("按地址查询");
    connect(queryAddrBtn, &QPushButton::clicked, this, &HistoryDialog::onQueryByAddress);
    filterLayout->addWidget(queryAddrBtn);

    QPushButton *queryAllBtn = new QPushButton("查询全部");
    connect(queryAllBtn, &QPushButton::clicked, this, &HistoryDialog::onQueryAll);
    filterLayout->addWidget(queryAllBtn);

    filterLayout->addStretch();

    m_countLabel = new QLabel("记录数: 0");
    filterLayout->addWidget(m_countLabel);

    QPushButton *refreshBtn = new QPushButton("刷新");
    connect(refreshBtn, &QPushButton::clicked, this, &HistoryDialog::onRefreshCount);
    filterLayout->addWidget(refreshBtn);

    QPushButton *clearBtn = new QPushButton("清空全部");
    clearBtn->setStyleSheet("color: red;");
    connect(clearBtn, &QPushButton::clicked, this, &HistoryDialog::onClearRecords);
    filterLayout->addWidget(clearBtn);

    mainLayout->addWidget(filterGroup);

    m_tableWidget = new QTableWidget();
    m_tableWidget->setColumnCount(8);
    m_tableWidget->setHorizontalHeaderLabels({
        "时间", "从站地址", "功能码", "起始地址",
        "数量", "数据", "原始帧", "类型"
    });
    m_tableWidget->horizontalHeader()->setStretchLastSection(true);
    m_tableWidget->setAlternatingRowColors(true);
    m_tableWidget->setSelectionBehavior(QAbstractItemView::SelectRows);
    mainLayout->addWidget(m_tableWidget);

    setLayout(mainLayout);
}

void HistoryDialog::populateTable(const QList<ModbusRecord> &records)
{
    m_tableWidget->setRowCount(records.size());

    for (int i = 0; i < records.size(); ++i) {
        const ModbusRecord &record = records[i];

        m_tableWidget->setItem(i, 0, new QTableWidgetItem(record.timestamp.toString("yyyy-MM-dd hh:mm:ss.zzz")));
        m_tableWidget->setItem(i, 1, new QTableWidgetItem(QString::number(record.slaveAddress)));
        m_tableWidget->setItem(i, 2, new QTableWidgetItem(functionCodeToString(record.functionCode)));
        m_tableWidget->setItem(i, 3, new QTableWidgetItem(QString::number(record.startAddress)));
        m_tableWidget->setItem(i, 4, new QTableWidgetItem(QString::number(record.quantity)));
        m_tableWidget->setItem(i, 5, new QTableWidgetItem(record.hexData));
        m_tableWidget->setItem(i, 6, new QTableWidgetItem(record.rawFrame));
        m_tableWidget->setItem(i, 7, new QTableWidgetItem(record.isResponse ? "响应" : "请求"));
    }

    m_tableWidget->resizeColumnsToContents();
}

QString HistoryDialog::functionCodeToString(uint8_t funcCode)
{
    switch (funcCode) {
    case 0x01: return "01-读线圈";
    case 0x02: return "02-读离散输入";
    case 0x03: return "03-读保持寄存器";
    case 0x04: return "04-读输入寄存器";
    case 0x05: return "05-写单个线圈";
    case 0x06: return "06-写单个寄存器";
    case 0x0F: return "0F-写多个线圈";
    case 0x10: return "10-写多个寄存器";
    default: return QString("%1-未知").arg(funcCode, 2, 16, QChar('0'));
    }
}

void HistoryDialog::onQueryAll()
{
    QList<ModbusRecord> records = m_dbManager->queryAllRecords();
    populateTable(records);
}

void HistoryDialog::onQueryByAddress()
{
    bool ok;
    uint16_t startAddr = m_startAddrEdit->text().toUInt(&ok);
    if (!ok) {
        QMessageBox::warning(this, "警告", "请输入有效的起始地址");
        return;
    }

    uint16_t endAddr = 0;
    if (!m_endAddrEdit->text().isEmpty()) {
        endAddr = m_endAddrEdit->text().toUInt(&ok);
        if (!ok) {
            QMessageBox::warning(this, "警告", "请输入有效的结束地址");
            return;
        }
    }

    QList<ModbusRecord> records = m_dbManager->queryByRegisterAddress(startAddr, endAddr);
    populateTable(records);
}

void HistoryDialog::onClearRecords()
{
    QMessageBox::StandardButton reply = QMessageBox::question(
        this, "确认", "确定要清空所有历史记录吗？此操作不可恢复！",
        QMessageBox::Yes | QMessageBox::No
    );

    if (reply == QMessageBox::Yes) {
        if (m_dbManager->clearAllRecords()) {
            QMessageBox::information(this, "成功", "已清空所有记录");
            onRefreshCount();
            onQueryAll();
        } else {
            QMessageBox::critical(this, "错误", "清空记录失败");
        }
    }
}

void HistoryDialog::onRefreshCount()
{
    int count = m_dbManager->getRecordCount();
    m_countLabel->setText(QString("记录数: %1").arg(count));
}
