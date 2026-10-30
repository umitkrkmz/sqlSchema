namespace Portal.Domain.Sales;

public class Dealer
{
    public int Id { get; set; }
    public string DealerCode { get; set; } = null!;
    public string Title { get; set; } = null!;
    public string? TaxNumber { get; set; }
    public DealerStatus Status { get; set; }
    public int? ParentDealerId { get; set; }
    public Dealer? ParentDealer { get; set; }
    public List<Dealer> SubDealers { get; } = new();
    public Address Address { get; set; } = null!;
    public List<DealerContact> Contacts { get; } = new();
    public DealerProfile? Profile { get; set; }
    public List<Region> Regions { get; } = new();
}
