QT       += core gui serialport sql

greaterThan(QT_MAJOR_VERSION, 4): QT += widgets

CONFIG += c++17

TARGET = ModbusRtuTool
TEMPLATE = app

SOURCES += \
    main.cpp \
    mainwindow.cpp \
    modbusparser.cpp \
    crc16.cpp \
    databasemanager.cpp \
    historydialog.cpp

HEADERS += \
    mainwindow.h \
    modbusparser.h \
    crc16.h \
    databasemanager.h \
    historydialog.h

FORMS += \
    mainwindow.ui

RESOURCES +=

# Default rules for deployment.
qnx: target.path = /tmp/$${TARGET}/bin
else: unix:!android: target.path = /opt/$${TARGET}/bin
!isEmpty(target.path): INSTALLS += target
