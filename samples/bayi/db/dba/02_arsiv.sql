-- Arşiv: kapanan siparişler her ay buraya taşınır (DBA). Bilinçli olarak PK ve FK yok.
CREATE SCHEMA [archive];
GO

CREATE TABLE [archive].[OrdersHistory] (
    [OrderId]      [bigint]         NOT NULL,
    [DealerId]     [int]            NOT NULL,
    [CustomerId]   [int]            NOT NULL,
    [OrderNo]      [nvarchar](30)   NOT NULL,
    [OrderedAt]    [datetime2](7)   NOT NULL,
    [TotalAmount]  [decimal](18, 2) NOT NULL,
    [ArchivedAt]   [datetime2](7)   NOT NULL CONSTRAINT [DF_OrdersHistory_ArchivedAt] DEFAULT (getutcdate())
);
GO

CREATE NONCLUSTERED INDEX [IX_OrdersHistory_Dealer] ON [archive].[OrdersHistory] ([DealerId], [OrderedAt]);
GO
