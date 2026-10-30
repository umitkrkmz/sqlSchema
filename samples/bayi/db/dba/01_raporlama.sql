-- Raporlama tabloları: uygulama yazmaz, gece işi doldurur (DBA)
CREATE SCHEMA [report];
GO

CREATE TABLE [report].[DealerMonthlyTarget] (
    [DealerId]      [int]            NOT NULL,
    [Period]        [char](6)        NOT NULL,
    [TargetAmount]  [decimal](18, 2) NOT NULL,
    [ActualAmount]  [decimal](18, 2) NULL,
    CONSTRAINT [PK_DealerMonthlyTarget] PRIMARY KEY CLUSTERED ([DealerId], [Period]),
    CONSTRAINT [FK_DealerMonthlyTarget_Dealers] FOREIGN KEY ([DealerId]) REFERENCES [sales].[Dealers] ([Id])
);
GO

CREATE TABLE [report].[CommissionRate] (
    [RegionId]      [int]           NOT NULL,
    [CategoryId]    [int]           NOT NULL,
    [Rate]          [decimal](5, 4) NOT NULL,
    [ValidFrom]     [date]          NOT NULL,
    CONSTRAINT [PK_CommissionRate] PRIMARY KEY CLUSTERED ([RegionId], [CategoryId], [ValidFrom]),
    CONSTRAINT [FK_CommissionRate_Regions] FOREIGN KEY ([RegionId]) REFERENCES [sales].[Regions] ([Id]),
    CONSTRAINT [FK_CommissionRate_Categories] FOREIGN KEY ([CategoryId]) REFERENCES [catalog].[ProductCategories] ([Id])
);
GO

EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'Bölge ve ürün kategorisine göre bayi komisyon oranı',
    @level0type = N'SCHEMA', @level0name = N'report', @level1type = N'TABLE', @level1name = N'CommissionRate';
GO
